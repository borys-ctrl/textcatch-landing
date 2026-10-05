const { verify, makeSessionToken, sessionCookie } = require("../../lib/auth");
const { checkCode } = require("../../lib/logincode");

// GET  /api/portal/verify?token=...      the link from the email (computers)
// POST /api/portal/verify { email, code } the 6-digit code (the phone app)
//
// Both swap proof of the inbox for a session cookie. The link redirects; the
// code answers JSON, because it is called from inside the app and the cookie
// has to land in the app's own cookie jar, not Safari's.
//
// Anything wrong gets one plain reason, never a stack trace, and never a hint
// about which part was wrong.

module.exports = async (req, res) => {
  var secret = process.env.PORTAL_SECRET;
  var allowed = process.env.PORTAL_EMAIL;

  if (req.method === "POST") {
    if (!secret || !allowed) {
      console.error("Portal not configured");
      return res.status(500).json({ error: "The portal is not configured yet." });
    }
    var body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    var email = (body.email || "").toString().trim().toLowerCase();
    // People paste "123 456" or "123-456"; only the digits matter.
    var code = (body.code || "").toString().replace(/\D/g, "");

    var result;
    try {
      result = await checkCode(email, code, secret);
    } catch (err) {
      console.error("Login code check failed:", err && err.message);
      return res.status(502).json({ error: "Could not check the code. Try again, or use the link in the email." });
    }
    if (!result.ok) return res.status(400).json({ error: result.error });

    res.setHeader("Set-Cookie", sessionCookie(makeSessionToken(email, secret)));
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

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
  if (!data || !data.e) {
    // Covers expired, tampered, wrong-kind and wrong-address in one message:
    // distinguishing them would tell an attacker which part they got right.
    return res.redirect(302, "/app?error=expired");
  }

  res.setHeader("Set-Cookie", sessionCookie(makeSessionToken(data.e, secret)));
  return res.redirect(302, "/app");
};
