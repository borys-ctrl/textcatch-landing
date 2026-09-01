const { requireSession } = require("./auth");
const { saveSubscription, deleteSubscription } = require("../../lib/webpush");

// /api/portal/push
//
//   GET    -> { publicKey }   the VAPID public key the browser needs to subscribe
//   POST   -> register this device for notifications
//   DELETE -> stop notifications on this device
//
// Session-gated except for GET, which returns a value that is public by design:
// the VAPID public key is shipped to every browser that subscribes, and knowing
// it lets nobody send a push, because sending requires the private half.
//
// Registering IS gated. Without that check a stranger could attach their own
// phone to the account and receive a copy of every lead notification.

module.exports = async (req, res) => {
  if (req.method === "GET") {
    var pub = process.env.VAPID_PUBLIC_KEY || null;
    return res.status(200).json({ publicKey: pub, enabled: !!pub });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var session = requireSession(req, res);
  if (!session) return;

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  try {
    if (req.method === "DELETE") {
      var endpoint = body.endpoint || (body.subscription && body.subscription.endpoint);
      if (!endpoint) return res.status(400).json({ error: "Which device?" });
      await deleteSubscription(endpoint);
      return res.status(200).json({ ok: true });
    }

    var sub = body.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: "No subscription" });

    // Only real push services. Without this the endpoint is an open invitation
    // to make our server POST anywhere on the internet on request.
    var host;
    try { host = new URL(sub.endpoint).hostname; } catch (e) { host = ""; }
    if (!/(^|\.)(push\.apple\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.microsoft\.com)$/.test(host)) {
      console.error("Refused push subscription for unexpected host:", host);
      return res.status(400).json({ error: "Unsupported push service" });
    }

    // A phone that re-subscribes hands back a new endpoint and orphans the old
    // one, which then fails forever. Clean it up while we know about it.
    if (body.replaces && body.replaces !== sub.endpoint) {
      try { await deleteSubscription(body.replaces); } catch (e) {}
    }

    await saveSubscription(session.e, sub, req.headers["user-agent"]);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Push subscription failed:", err && err.message);
    return res.status(502).json({ error: "Could not save this device" });
  }
};
