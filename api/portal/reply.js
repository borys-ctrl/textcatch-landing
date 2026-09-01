const { requireSession } = require("./auth");
const { saveMessage, touchConversation } = require("../store");

// POST /api/portal/reply  { conversationId, body }
//
// Sends a text from the TextCatch number to the lead on that conversation,
// then logs it as an outbound message so the thread reads as a conversation
// rather than a list of things they said to us.

// Two segments. Past this the lead receives several separate texts, which
// reads badly, so we refuse rather than send something ugly.
var MAX_BODY = 640;

async function supabase(path) {
  var base = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error("storage not configured");
  var r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/" + path, {
    headers: { apikey: key, Authorization: "Bearer " + key },
  });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}

async function sendSms(to, body) {
  var sid = process.env.TWILIO_ACCOUNT_SID;
  var token = process.env.TWILIO_AUTH_TOKEN;
  var from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) throw new Error("SMS not configured");

  var r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(sid + ":" + token).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!r.ok) throw new Error("Twilio " + r.status + ": " + (await r.text()).slice(0, 300));
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireSession(req, res)) return;

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var conversationId = parseInt(body.conversationId, 10);
  var text = (body.body || "").toString().trim();

  if (!conversationId || isNaN(conversationId)) {
    return res.status(400).json({ error: "Which conversation?" });
  }
  if (!text) return res.status(400).json({ error: "Nothing to send" });
  if (text.length > MAX_BODY) {
    return res.status(400).json({
      error: "That is " + text.length + " characters. Keep it under " + MAX_BODY +
             " so it arrives as one or two texts.",
    });
  }

  try {
    // Look the number up server-side rather than trusting one from the client:
    // otherwise the portal becomes a way to text any number in the world.
    var rows = await supabase(
      "conversations?id=eq." + conversationId + "&select=id,lead_phone&limit=1"
    );
    if (!rows || !rows.length) return res.status(404).json({ error: "No such conversation" });
    var phone = rows[0].lead_phone;
    if (!phone) return res.status(409).json({ error: "That conversation has no phone number" });

    var sent = await sendSms(phone, text);

    // Sent is what matters; a logging failure must not tell the user it failed
    // and tempt them into sending it twice.
    try {
      await saveMessage({
        conversation_id: conversationId,
        direction: "outbound",
        body: text,
        from_number: process.env.TWILIO_PHONE_NUMBER || null,
        to_number: phone,
        twilio_sid: (sent && sent.sid) || null,
      });
      await touchConversation(conversationId);
    } catch (logErr) {
      console.error("Reply sent but not logged:", logErr && logErr.message, { conversationId: conversationId });
    }

    return res.status(200).json({ ok: true, sid: sent && sent.sid, to: phone });
  } catch (err) {
    console.error("Portal reply failed:", err && err.message);
    return res.status(502).json({ error: "Could not send that text" });
  }
};
