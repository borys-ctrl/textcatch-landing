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

// --- Conversations -------------------------------------------------------
//
// Shared helper so both the inbound webhook and any outbound send land in the
// same thread. Unlike insertRow these need the row back, so they ask Supabase
// to return it.

async function supabase(path, opts) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return { skipped: true, reason: "storage not configured" };

  const r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: Object.assign({
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error("Supabase " + r.status + " on " + path + ": " + detail);
  }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Find the thread for this person, or start one. Upsert on (site_id,
// lead_phone) so two texts arriving at once cannot create two threads.
async function findOrCreateConversation(siteId, leadPhone, leadName) {
  const rows = await supabase("conversations?on_conflict=site_id,lead_phone", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: [{
      site_id: siteId,
      lead_phone: leadPhone,
      lead_name: leadName || null,
      last_message_at: new Date().toISOString(),
    }],
  });
  if (!rows || rows.skipped) return rows;
  return Array.isArray(rows) ? rows[0] : rows;
}

// Append a message. Duplicate twilio_sid is ignored rather than erroring,
// because Twilio retries any webhook whose response it did not like.
async function saveMessage(msg) {
  const rows = await supabase("messages?on_conflict=twilio_sid", {
    method: "POST",
    headers: {
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: [msg],
  });
  if (!rows || rows.skipped) return rows;
  return Array.isArray(rows) ? rows[0] || { duplicate: true } : rows;
}

async function touchConversation(id) {
  return supabase("conversations?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { last_message_at: new Date().toISOString() },
  });
}

module.exports = {
  saveLead: saveLead,
  saveTrialSignup: saveTrialSignup,
  findOrCreateConversation: findOrCreateConversation,
  saveMessage: saveMessage,
  touchConversation: touchConversation,
};
