const crypto = require("crypto");

// Six-digit sign-in codes for the portal.
//
// Why codes as well as links: on an iPhone the installed app keeps its own
// cookies, separate from Safari. A link tapped in Mail opens Safari and signs
// Safari in - the app never sees it and keeps asking for an email. A code is
// typed into the app itself, so the session cookie lands in the app.
//
// Guessing is what makes codes dangerous - there are only a million of them -
// so each one is limited:
//   - valid for 10 minutes
//   - 5 wrong tries, then it is dead
//   - only the newest code for an address works
//   - at most 5 codes per address per hour
// That caps a stranger at 25 guesses an hour, and each new code they trigger
// lands in the owner's inbox where it gets noticed.
//
// Only a hash of the code is stored, keyed with PORTAL_SECRET, so the table
// alone is no help to anyone who reads it.
//
// Table (run once in Supabase):
//   create table if not exists login_codes (
//     id bigserial primary key,
//     email text not null,
//     code_hash text not null,
//     attempts int not null default 0,
//     expires_at timestamptz not null,
//     used_at timestamptz,
//     created_at timestamptz not null default now()
//   );
//   create index if not exists login_codes_email_idx on login_codes (email, created_at desc);
//   alter table login_codes enable row level security;

var CODE_TTL_MS = 10 * 60 * 1000;
var MAX_ATTEMPTS = 5;
var MAX_CODES_PER_HOUR = 5;

// One message for every failure. Saying "expired" or "too many tries" would
// confirm to a stranger that an address has an account.
var FAILED = "That code didn't work or has expired. Check it, or request a new one.";

async function sb(path, opts) {
  opts = opts || {};
  var base = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) throw new Error("storage not configured");
  var r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: Object.assign({
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()).slice(0, 200));
  var text = await r.text();
  return text ? JSON.parse(text) : null;
}

function enc(s) { return encodeURIComponent(String(s)); }

function hashCode(secret, email, code) {
  return crypto.createHmac("sha256", secret).update("login-code:" + email + ":" + code).digest("hex");
}

function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Returns { code } or { limited: true }. Throws if storage is unavailable, so
// the caller can fall back to sending the link alone.
async function issueCode(email, secret) {
  var since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  var recent = await sb("login_codes?select=id&email=eq." + enc(email) + "&created_at=gte." + enc(since));
  if ((recent || []).length >= MAX_CODES_PER_HOUR) return { limited: true };

  var code = newCode();
  await sb("login_codes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: [{
      email: email,
      code_hash: hashCode(secret, email, code),
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    }],
  });
  return { code: code };
}

// Returns { ok: true } or { error }. Throws only if storage is unavailable.
async function checkCode(email, code, secret) {
  if (!email || !/^\d{6}$/.test(code || "")) return { error: FAILED };

  var rows = await sb("login_codes?select=id,code_hash,attempts,expires_at,used_at" +
    "&email=eq." + enc(email) + "&order=created_at.desc&limit=1");
  var row = rows && rows[0];
  if (!row || row.used_at) return { error: FAILED };
  if (!(Date.parse(row.expires_at) > Date.now())) return { error: FAILED };
  if (row.attempts >= MAX_ATTEMPTS) return { error: FAILED };

  // Count the try BEFORE checking it, and only if nobody else counted one in
  // the meantime. Without the attempts=eq condition, fifty guesses sent at
  // once would all read "0 tries so far" and all be checked.
  var bumped = await sb("login_codes?id=eq." + row.id + "&attempts=eq." + row.attempts + "&used_at=is.null", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: { attempts: row.attempts + 1 },
  });
  if (!bumped || !bumped.length) return { error: FAILED };

  var want = Buffer.from(String(row.code_hash), "hex");
  var got = Buffer.from(hashCode(secret, email, code), "hex");
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { error: FAILED };

  // Spend it, so the same code cannot sign in twice.
  var used = await sb("login_codes?id=eq." + row.id + "&used_at=is.null", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: { used_at: new Date().toISOString() },
  });
  if (!used || !used.length) return { error: FAILED };

  return { ok: true };
}

module.exports = {
  issueCode: issueCode,
  checkCode: checkCode,
  hashCode: hashCode,
  FAILED: FAILED,
  CODE_TTL_MS: CODE_TTL_MS,
  MAX_ATTEMPTS: MAX_ATTEMPTS,
  MAX_CODES_PER_HOUR: MAX_CODES_PER_HOUR,
};
