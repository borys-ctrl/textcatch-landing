const { requireSiteAccess } = require("../../lib/auth");
const { replyPermission, inList } = require("../../lib/consent");

// GET /api/portal/threads
//
// Every conversation, newest activity first, each with its messages.
// Session-gated: these are customer phone numbers and message bodies, and the
// service key never leaves the server.
//
// Each thread also says whether it may be texted (canReply) and, if not, why
// (replyBlocked), so the app can hide the Send box instead of offering one
// that can only fail. The reply endpoint enforces the same rule.

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
  var access = await requireSiteAccess(req, res, null);
  if (!access) return;

  try {
    // One request. PostgREST embeds the messages, so a busy inbox does not
    // become one query per thread. Owners see only their sites' threads.
    var filter = "";
    if (!access.all) {
      var ids = (access.sites || []).map(function (s) { return s.id; });
      if (!ids.length) return res.status(200).json({ ok: true, threads: [] });
      filter = "&site_id=in.(" + ids.map(encodeURIComponent).join(",") + ")";
    }
    var rows = await supabase(
      "conversations?select=id,site_id,lead_phone,lead_name,last_message_at,created_at," +
      "messages(id,direction,body,created_at,twilio_sid)" +
      "&order=last_message_at.desc&limit=200" + filter
    );

    // The consent box lives on the widget submission, in `leads`. One query
    // for every phone on screen. If it fails the inbox still loads, but
    // threads that depend on it show as not textable: when in doubt, don't.
    var leadsByKey = {};
    var phones = [];
    (rows || []).forEach(function (c) {
      if (c.lead_phone && phones.indexOf(c.lead_phone) === -1) phones.push(c.lead_phone);
    });
    if (phones.length) {
      try {
        var leads = await supabase("leads?select=*&phone=in." + inList(phones) + "&limit=1000");
        (leads || []).forEach(function (l) {
          var k = l.site_id + "|" + l.phone;
          (leadsByKey[k] = leadsByKey[k] || []).push(l);
        });
      } catch (err) {
        console.error("Consent lookup failed:", err && err.message);
      }
    }

    var threads = (rows || []).map(function (c) {
      var msgs = (c.messages || []).slice().sort(function (a, b) {
        return new Date(a.created_at) - new Date(b.created_at);
      });
      var last = msgs.length ? msgs[msgs.length - 1] : null;
      var perm = replyPermission(msgs, leadsByKey[c.site_id + "|" + c.lead_phone] || []);
      return {
        id: c.id,
        siteId: c.site_id,
        phone: c.lead_phone,
        name: c.lead_name || null,
        lastMessageAt: c.last_message_at,
        preview: last ? (last.body || "").slice(0, 120) : "",
        lastDirection: last ? last.direction : null,
        canReply: perm.canReply,
        replyBlocked: perm.reason,
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
