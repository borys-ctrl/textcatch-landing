const { requireSession } = require("./auth");

// GET /api/portal/threads
//
// Every conversation, newest activity first, each with its messages.
// Session-gated: these are customer phone numbers and message bodies, and the
// service key never leaves the server.

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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!requireSession(req, res)) return;

  try {
    // One request. PostgREST embeds the messages, so a busy inbox does not
    // become one query per thread.
    var rows = await supabase(
      "conversations?select=id,site_id,lead_phone,lead_name,last_message_at,created_at," +
      "messages(id,direction,body,created_at,twilio_sid)" +
      "&order=last_message_at.desc&limit=200"
    );

    var threads = (rows || []).map(function (c) {
      var msgs = (c.messages || []).slice().sort(function (a, b) {
        return new Date(a.created_at) - new Date(b.created_at);
      });
      var last = msgs.length ? msgs[msgs.length - 1] : null;
      return {
        id: c.id,
        phone: c.lead_phone,
        name: c.lead_name || null,
        lastMessageAt: c.last_message_at,
        preview: last ? (last.body || "").slice(0, 120) : "",
        lastDirection: last ? last.direction : null,
        messages: msgs.map(function (m) {
          return { id: m.id, direction: m.direction, body: m.body, at: m.created_at };
        }),
      };
    });

    return res.status(200).json({ ok: true, threads: threads });
  } catch (err) {
    console.error("Portal threads failed:", err && err.message);
    return res.status(502).json({ error: "Could not load conversations" });
  }
};
