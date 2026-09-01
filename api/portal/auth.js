const crypto = require("crypto");

// Shared auth for the TextCatch portal.
//
// Two kinds of token, both HMAC-signed with PORTAL_SECRET and both carrying
// their own expiry:
//
//   login   - emailed as a one-time link, valid 15 minutes
//   session - set as an httpOnly cookie after the link is used, valid 30 days
//
// There is no user table and no password. The only account that can ever log
// in is PORTAL_EMAIL. That keeps the whole surface to one comparison.
//
// Env:
//   PORTAL_SECRET - required. Signing key. Without it nothing authenticates.
//   PORTAL_EMAIL  - required. The single address allowed to sign in.

var LOGIN_TTL_MS = 15 * 60 * 1000;
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var COOKIE = "tc_session";

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  var t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

function sign(payloadObj, secret) {
  var payload = b64url(JSON.stringify(payloadObj));
  var mac = crypto.createHmac("sha256", secret).update(payload).digest();
  return payload + "." + b64url(mac);
}

// Returns the payload, or null. Never throws on malformed input: this runs on
// whatever a stranger chooses to send.
function verify(token, secret, expectedKind) {
  if (!token || !secret) return null;
  var parts = String(token).split(".");
  if (parts.length !== 2) return null;

  var expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  var got = fromB64url(parts[1]);
  // Compare before parsing. An attacker must forge the signature to get any
  // further, so malformed JSON never reaches JSON.parse from an unsigned token.
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;

  var data;
  try { data = JSON.parse(fromB64url(parts[0]).toString("utf-8")); } catch (e) { return null; }
  if (!data || typeof data !== "object") return null;
  if (expectedKind && data.k !== expectedKind) return null;
  if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
  return data;
}

function makeLoginToken(email, secret) {
  return sign({ k: "login", e: email, exp: Date.now() + LOGIN_TTL_MS, n: b64url(crypto.randomBytes(9)) }, secret);
}

function makeSessionToken(email, secret) {
  return sign({ k: "session", e: email, exp: Date.now() + SESSION_TTL_MS }, secret);
}

function sessionCookie(token) {
  return COOKIE + "=" + token +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + Math.floor(SESSION_TTL_MS / 1000);
}

function clearCookie() {
  return COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function readCookie(req) {
  var raw = (req.headers && req.headers.cookie) || "";
  var found = null;
  raw.split(";").forEach(function (part) {
    var i = part.indexOf("=");
    if (i < 0) return;
    if (part.slice(0, i).trim() === COOKIE) found = part.slice(i + 1).trim();
  });
  return found;
}

// The gate every portal endpoint sits behind. Returns the session payload, or
// sends 401 and returns null - so a caller that forgets to check still fails
// closed rather than serving data.
function requireSession(req, res) {
  var secret = process.env.PORTAL_SECRET;
  if (!secret) {
    console.error("PORTAL_SECRET missing - refusing all portal access");
    res.status(500).json({ error: "Portal not configured" });
    return null;
  }
  var data = verify(readCookie(req), secret, "session");
  if (!data || data.e !== process.env.PORTAL_EMAIL) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  return data;
}

module.exports = {
  sign: sign,
  verify: verify,
  makeLoginToken: makeLoginToken,
  makeSessionToken: makeSessionToken,
  sessionCookie: sessionCookie,
  clearCookie: clearCookie,
  readCookie: readCookie,
  requireSession: requireSession,
  LOGIN_TTL_MS: LOGIN_TTL_MS,
  SESSION_TTL_MS: SESSION_TTL_MS,
  COOKIE: COOKIE,
};
