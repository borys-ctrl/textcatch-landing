const crypto = require("crypto");

// Web Push, implemented against the RFCs directly so the project takes on no
// npm dependency and nothing about a lead ever passes through Apple's or
// Google's push servers.
//
// The trick that makes this small: we send a push with NO PAYLOAD.
//
// A payload-carrying push has to be encrypted with AES128GCM plus an ECDH key
// agreement per message (RFC 8291) - a few hundred lines that are easy to get
// subtly wrong. A payload-less push needs only a signed VAPID token (RFC 8292),
// which is an ES256 JWT. The service worker reacts by fetching the real
// conversation from our own API using the session cookie.
//
// So the push is a doorbell, not a letter. Apple learns that something happened
// at textcatch.app; it never learns who texted, or what they said. If someone
// compromised the push service they would get a stream of empty rings.
//
// Env:
//   VAPID_PUBLIC_KEY   - base64url, uncompressed P-256 point (65 bytes, 0x04||x||y)
//   VAPID_PRIVATE_KEY  - base64url, raw 32-byte scalar
//   VAPID_SUBJECT      - "mailto:you@example.com", required by the spec

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
}

// Node will not import a raw scalar, so rebuild the JWK the private key needs.
// x and y come out of the public point: it is 0x04 then 32 bytes then 32 bytes.
function privateKeyFrom(publicB64, privateB64) {
  const pub = fromB64url(publicB64);
  const d = fromB64url(privateB64);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY is not a 65-byte uncompressed P-256 point");
  }
  if (d.length !== 32) throw new Error("VAPID_PRIVATE_KEY is not 32 bytes");
  return crypto.createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: b64url(d),
    },
  });
}

// The audience is the ORIGIN of the push endpoint, not the whole URL. Getting
// this wrong is the classic cause of a 401 from Apple that looks like a key
// problem but is not.
function vapidToken(endpoint, publicB64, privateB64, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64url(JSON.stringify({
    aud: aud,
    // Spec caps this at 24h. Twelve keeps us clear of clock skew at both ends.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  }));
  const signingInput = header + "." + body;

  // Node defaults to DER-encoded ECDSA signatures; JWS requires the raw
  // r||s form. Without ieee-p1363 every token is rejected as malformed.
  const sig = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKeyFrom(publicB64, privateB64),
    dsaEncoding: "ieee-p1363",
  });
  return signingInput + "." + b64url(sig);
}

function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY &&
            process.env.VAPID_PRIVATE_KEY &&
            process.env.VAPID_SUBJECT);
}

// Returns { ok } on success, { gone: true } if the subscription is dead and
// should be deleted, { error } otherwise. Never throws: a failed notification
// must not take down the request that triggered it.
async function sendPush(endpoint, opts) {
  opts = opts || {};
  if (!pushConfigured()) return { error: "push not configured" };
  if (!endpoint) return { error: "no endpoint" };

  let token;
  try {
    token = vapidToken(endpoint, process.env.VAPID_PUBLIC_KEY,
                       process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT);
  } catch (err) {
    return { error: "vapid: " + (err && err.message) };
  }

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "vapid t=" + token + ", k=" + process.env.VAPID_PUBLIC_KEY,
        TTL: String(opts.ttl == null ? 3600 : opts.ttl),
        // "high" tells the phone to wake for this rather than batch it with
        // background chatter. A lead waiting on a reply is the whole product.
        Urgency: opts.urgency || "high",
        "Content-Length": "0",
      },
    });

    // 404 and 410 mean the browser threw the subscription away - reinstalled,
    // permission revoked, app deleted. Anything else may be transient.
    if (r.status === 404 || r.status === 410) return { gone: true, status: r.status };
    if (!r.ok) {
      const detail = await r.text().catch(function () { return ""; });
      return { error: "push " + r.status + ": " + detail.slice(0, 200), status: r.status };
    }
    return { ok: true, status: r.status };
  } catch (err) {
    return { error: (err && err.message) || "push failed" };
  }
}

// ---------------------------------------------------------------------------
// Subscription storage. Kept here rather than in store.js so everything about
// push lives in one file and the rest of the app can ignore it entirely.
// ---------------------------------------------------------------------------

async function supabase(path, init) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error("storage not configured");

  // Merge the caller's options FIRST, then set headers, and never the other way
  // round. Written the other way, an init that carries its own `headers` (the
  // upsert sends a Prefer header) replaces the whole header object and takes the
  // apikey with it - the request then fails auth, which surfaces as "could not
  // save" and looks like a database problem rather than a one-line merge bug.
  const opts = Object.assign({}, init || {});
  opts.headers = Object.assign({
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  }, (init && init.headers) || {});

  const r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/" + path, opts);
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()).slice(0, 200));
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function saveSubscription(email, sub, userAgent) {
  if (!sub || !sub.endpoint) throw new Error("no endpoint");
  const keys = sub.keys || {};
  return supabase("push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{
      email: email,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh || null,
      auth: keys.auth || null,
      user_agent: (userAgent || "").slice(0, 300) || null,
    }]),
  });
}

async function deleteSubscription(endpoint) {
  if (!endpoint) return null;
  return supabase("push_subscriptions?endpoint=eq." + encodeURIComponent(endpoint),
    { method: "DELETE" });
}

async function listSubscriptions() {
  return (await supabase("push_subscriptions?select=id,endpoint&limit=50")) || [];
}

// Ring every device he has installed. Never throws, and returns a summary so
// the caller can log it: a silent notification failure is the exact bug this
// whole feature exists to prevent, so it must at minimum show up in the logs.
async function notifyDevices() {
  if (!pushConfigured()) return { skipped: "push not configured" };

  let subs;
  try {
    subs = await listSubscriptions();
  } catch (err) {
    return { error: "could not read subscriptions: " + (err && err.message) };
  }
  if (!subs.length) return { sent: 0, note: "no devices subscribed" };

  const results = await Promise.all(subs.map(function (s) { return sendPush(s.endpoint); }));

  let sent = 0;
  const dead = [];
  results.forEach(function (r, i) {
    if (r.ok) sent++;
    else if (r.gone) dead.push(subs[i].endpoint);
    else console.error("Push failed:", r.error);
  });

  // Prune revoked devices, or every future send retries a corpse.
  for (const endpoint of dead) {
    try { await deleteSubscription(endpoint); } catch (e) {}
  }

  return { sent: sent, removed: dead.length, of: subs.length };
}

module.exports = {
  sendPush, vapidToken, pushConfigured, b64url, fromB64url,
  saveSubscription, deleteSubscription, listSubscriptions, notifyDevices,
};
