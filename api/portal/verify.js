const { verify, makeSessionToken, sessionCookie } = require("./auth");

// GET /api/portal/verify?token=...
//
// Opens from the email. Swaps a valid login token for a session cookie and
// redirects to the portal. Anything wrong sends you back to the sign-in page
// with a reason, never a stack trace.

module.exports = async (req, res) => {
  var secret = process.env.PORTAL_SECRET;
  var allowed = process.env.PORTAL_EMAIL;
  if (!secret || !allowed) {
    console.error("Portal not configured");
    return res.redirect(302, "/app?error=notconfigured");
  }

  var token = "";
  try {
    token = new URL(req.url, "https://x").searchParams.get("token") || "";
  } catch (e) {
    token = "";
  }

  var data = verify(token, secret, "login");
  if (!data || data.e !== allowed) {
    // Covers expired, tampered, wrong-kind and wrong-address in one message:
    // distinguishing them would tell an attacker which part they got right.
    return res.redirect(302, "/app?error=expired");
  }

  res.setHeader("Set-Cookie", sessionCookie(makeSessionToken(allowed, secret)));
  return res.redirect(302, "/app");
};
