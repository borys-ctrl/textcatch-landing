// Durable storage for anything we must not lose.
//
// Backed by Supabase over its REST API (plain fetch, no npm deps, matching the
// rest of this codebase). Set these in the Vercel project to switch it on:
//   SUPABASE_URL          e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_KEY  the secret key (server-side only, never public)
//
// If either is missing every write no-ops. That is intentional: unconfigured or
// broken storage must never stop a customer getting their lead by text, or a
// trial signup getting its email.

async function insertRow(table, row) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return { skipped: true, reason: "storage not configured" };

  const r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/" + table, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error("Supabase " + r.status + " on " + table + ": " + detail);
  }
  return { ok: true };
}

// A lead captured by the chat widget on a customer site.
function saveLead(lead) {
  return insertRow("leads", lead);
}

// Someone asking to try TextCatch via the landing page trial form.
function saveTrialSignup(signup) {
  return insertRow("trial_signups", signup);
}

module.exports = { saveLead: saveLead, saveTrialSignup: saveTrialSignup };
