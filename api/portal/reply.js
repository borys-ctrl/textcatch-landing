const { requireSiteAccess } = require("../../lib/auth");
const { saveMessage, touchConversation } = require("../../lib/store");
const { getSite, textsUsedThisMonth } = require("../../lib/sites");
const twilio = require("../../lib/twilio");

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

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  var access = await requireSiteAccess(req, res, null);
  if (!access) return;

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
      "conversations?id=eq." + conversationId + "&select=id,lead_phone,site_id&limit=1"
    );
    if (!rows || !rows.length) return res.status(404).json({ error: "No such conversation" });
    var phone = rows[0].lead_phone;
    if (!phone) return res.status(409).json({ error: "That conversation has no phone number" });

    // Owners may only reply on their own sites' threads.
    var site = await getSite(rows[0].site_id);
    if (!site) return res.status(404).json({ error: "No such site" });
    if (!access.all && !(access.sites || []).some(function (s) { return s.id === site.id; })) {
      return res.status(403).json({ error: "Not your conversation" });
    }
    var used = await textsUsedThisMonth(site.id);
    if (used >= site.plan.texts) {
      return res.status(402).json({ error: "This site has used its " + site.plan.texts + " texts for the month. Upgrade to keep texting." });
    }

    var sent = await twilio.sendSms({ from: site.fromNumber, to: phone, body: text });

    // Sent is what matters; a logging failure must not tell the user it failed
    // and tempt them into sending it twice.
    try {
      await saveMessage({
        conversation_id: conversationId,
        direction: "outbound",
        body: text,
        from_number: site.fromNumber || null,
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
