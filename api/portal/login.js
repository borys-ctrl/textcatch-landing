const { makeLoginToken, isAdmin } = require("../../lib/auth");
const { sendEmail } = require("../../lib/notify");
const { getSitesByOwner } = require("../../lib/sites");

// POST /api/portal/login  { email }
//
// Emails a one-time sign-in link to the admin or to any address that owns a
// site. Always answers "check your inbox", whatever address was submitted:
// replying differently for a valid address would turn this into an oracle
// telling a stranger who has access.

function baseUrl(req) {
  var host = req.headers["x-forwarded-host"] || req.headers.host || "textcatch.app";
  var proto = req.headers["x-forwarded-proto"] || "https";
  return proto + "://" + host;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var secret = process.env.PORTAL_SECRET;
  var allowed = process.env.PORTAL_EMAIL;
  if (!secret || !allowed) {
    console.error("Portal not configured", { secret: !!secret, email: !!allowed });
    return res.status(500).json({ error: "Portal not configured" });
  }

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var email = (body.email || "").toString().trim().toLowerCase();

  // The generic reply, sent no matter what happens below.
  var ok = { ok: true, message: "If that address has access, a sign-in link is on its way." };

  var known = isAdmin(email);
  if (!known) {
    try { known = (await getSitesByOwner(email)).length > 0; }
    catch (e) { console.error("Login owner lookup failed:", e && e.message); }
  }
  if (!known) {
    console.log("Portal login attempted for an unknown address");
    return res.status(200).json(ok);
  }

  var link = baseUrl(req) + "/api/portal/verify?token=" +
    encodeURIComponent(makeLoginToken(email, secret));

  try {
    await sendEmail({
      to: [email],
      subject: "Sign in to TextCatch",
      text: "Tap to sign in. The link works once and expires in 15 minutes." +
        String.fromCharCode(10) + String.fromCharCode(10) + link,
      html: '<p>Tap to sign in to the TextCatch portal.</p>' +
        '<p><a href="' + link + '">Sign in</a></p>' +
        '<p style="color:#666;font-size:13px">This link expires in 15 minutes. ' +
        'If you did not request it, ignore this email - nothing happens until it is opened.</p>',
    });
  } catch (err) {
    // Logged, but the response stays identical so failures leak nothing either.
    console.error("Portal login email failed:", err && err.message);
  }

  return res.status(200).json(ok);
};
