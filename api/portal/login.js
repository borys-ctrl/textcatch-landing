const { makeLoginToken, isAdmin } = require("../../lib/auth");
const { sendEmail } = require("../../lib/notify");
const { getSitesByOwner } = require("../../lib/sites");
const { issueCode } = require("../../lib/logincode");

// POST /api/portal/login  { email }
//
// Emails a 6-digit sign-in code, plus a one-time link, to the admin or to any
// address that owns a site. Always answers the same way, whatever address was
// submitted: replying differently for a valid address would turn this into an
// oracle telling a stranger who has access.
//
// The code is for the installed phone app, which cannot use the link (see
// lib/logincode.js). The link stays for computers, where it is one click.

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
  var ok = { ok: true, message: "If that address has access, a code is on its way. Check your email." };

  var known = isAdmin(email);
  if (!known) {
    try { known = (await getSitesByOwner(email)).length > 0; }
    catch (e) { console.error("Login owner lookup failed:", e && e.message); }
  }
  if (!known) {
    console.log("Portal login attempted for an unknown address");
    return res.status(200).json(ok);
  }

  // A code if we can make one. If storage is down the link still works, so
  // sign-in degrades to the old behaviour rather than breaking.
  var code = null;
  try {
    var issued = await issueCode(email, secret);
    if (issued.limited) {
      // Five codes in an hour. Send nothing: more emails would only help
      // someone guessing, and would flood the owner's inbox.
      console.log("Portal login code rate-limited");
      return res.status(200).json(ok);
    }
    code = issued.code;
  } catch (err) {
    console.error("Login code unavailable, sending link only:", err && err.message);
  }

  var link = baseUrl(req) + "/api/portal/verify?token=" +
    encodeURIComponent(makeLoginToken(email, secret));
  var NL = String.fromCharCode(10);

  try {
    await sendEmail({
      to: [email],
      subject: code ? "Your TextCatch code: " + code : "Sign in to TextCatch",
      text: (code
          ? "Your sign-in code is " + code + NL + NL +
            "Type it into the TextCatch app. It expires in 10 minutes." + NL + NL +
            "On a computer? You can use this link instead:" + NL
          : "Tap to sign in. The link works once and expires in 15 minutes." + NL + NL) +
        link,
      html: (code
          ? '<p>Your TextCatch sign-in code is</p>' +
            '<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:8px 0 16px">' + code + '</p>' +
            '<p>Type it into the TextCatch app. It expires in 10 minutes.</p>' +
            '<p style="color:#666;font-size:13px">On a computer? <a href="' + link + '">Sign in with this link</a> instead.</p>'
          : '<p>Tap to sign in to the TextCatch portal.</p>' +
            '<p><a href="' + link + '">Sign in</a></p>' +
            '<p style="color:#666;font-size:13px">This link expires in 15 minutes.</p>') +
        '<p style="color:#666;font-size:13px">If you did not request this, ignore this email - nothing happens unless the code or link is used.</p>',
    });
  } catch (err) {
    // Logged, but the response stays identical so failures leak nothing either.
    console.error("Portal login email failed:", err && err.message);
  }

  return res.status(200).json(ok);
};
