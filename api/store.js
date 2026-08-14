// Durable lead log.
//
// Every widget lead is written here before the SMS goes out, so a lead
// survives a failed text and can be exported later. Storage is deliberately
// isolated in this one file — swapping providers means editing only this.
//
// Backed by Supabase over its REST API (plain fetch, no npm deps, matching the
// rest of this codebase). Set these in the Vercel project to switch it on:
//   SUPABASE_URL          e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (server-side only, never public)
//
// If either is missing this no-ops. That is intentional: an unconfigured or
// broken lead log must never stop a customer from getting their lead by text.

async function saveLead(lead) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return { skipped: true, reason: "storage not configured" };

  const r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/leads", {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(lead),
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error("Supabase " + r.status + ": " + detail);
  }
  return { ok: true };
}

module.exports = { saveLead: saveLead };
