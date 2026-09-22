// Tenant registry, backed by the `sites` table in Supabase.
//
// Every request that touches a customer goes through here: the widget sends a
// siteId, the inbound SMS webhook sends a phone number, the portal sends an
// owner email. Each resolves to one site row plus its plan.
//
// The two original installs (textcatch, bfh) predate the table. Their owner
// phones still live in env vars (OWNER_PHONE_TEXTCATCH, OWNER_PHONE_BFH), and
// if the table is unreachable they keep working from the hardcoded fallback
// below, so a database hiccup never silences the founder's own leads.

const { getPlan, monthStart } = require("./plans");

const LEGACY = {
  textcatch: { businessName: "TextCatch", agentName: "Borys", ownerPhoneEnv: "OWNER_PHONE_TEXTCATCH", plan: "business" },
  bfh:       { businessName: "Best Flooring Honolulu", agentName: "Kai", ownerPhoneEnv: "OWNER_PHONE_BFH", plan: "business" },
};

const DEFAULT_SITE_ID = "textcatch";

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function sb(path, opts) {
  opts = opts || {};
  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(base + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: Object.assign({
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error("Supabase " + r.status + " on " + path + ": " + (await r.text()).slice(0, 300));
  if (opts.raw) return r;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Normalise a row into the shape the rest of the code expects.
function shape(row) {
  if (!row) return null;
  const legacy = LEGACY[row.id];
  const phone = row.owner_phone
    || (legacy && process.env[legacy.ownerPhoneEnv])
    || (legacy && process.env.OWNER_PHONE_NUMBER)
    || "";
  const plan = getPlan(row.plan);
  return {
    id: row.id,
    businessName: row.business_name || (legacy && legacy.businessName) || row.id,
    agentName: row.agent_name || (legacy && legacy.agentName) || "",
    ownerEmail: (row.owner_email || "").toLowerCase(),
    ownerPhone: phone,
    website: row.website || "",
    planId: row.plan || "free",
    plan: plan,
    twilioNumber: row.twilio_number || null,
    // Which number this site texts from. Dedicated if it has one, else shared.
    fromNumber: row.twilio_number || process.env.TWILIO_PHONE_NUMBER || "",
    stripeCustomerId: row.stripe_customer_id || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    accent: row.accent || null,
    branding: row.branding !== false,
    createdAt: row.created_at || null,
  };
}

function legacyRow(id) {
  const l = LEGACY[id];
  if (!l) return null;
  return { id: id, business_name: l.businessName, agent_name: l.agentName, owner_email: "", plan: l.plan, branding: false };
}

async function getSite(siteId) {
  const id = (siteId || DEFAULT_SITE_ID).toString().trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) return null;
  if (configured()) {
    try {
      const rows = await sb("sites?id=eq." + encodeURIComponent(id) + "&limit=1");
      if (rows && rows.length) return shape(rows[0]);
    } catch (err) {
      console.error("sites lookup failed:", err && err.message);
    }
  }
  return shape(legacyRow(id));
}

// Inbound SMS: which site owns the number that was texted.
async function getSiteByNumber(to) {
  if (!to || !configured()) return null;
  try {
    const rows = await sb("sites?twilio_number=eq." + encodeURIComponent(to) + "&limit=1");
    if (rows && rows.length) return shape(rows[0]);
  } catch (err) {
    console.error("sites by-number lookup failed:", err && err.message);
  }
  return null;
}

// Shared number: a text arriving on it belongs to whichever site this phone
// was most recently talking to.
async function getSiteForSharedInbound(leadPhone) {
  if (!leadPhone || !configured()) return null;
  try {
    const rows = await sb("conversations?lead_phone=eq." + encodeURIComponent(leadPhone) +
      "&select=site_id&order=last_message_at.desc&limit=1");
    if (rows && rows.length && rows[0].site_id) return getSite(rows[0].site_id);
  } catch (err) {
    console.error("shared inbound lookup failed:", err && err.message);
  }
  return null;
}

async function getSitesByOwner(email) {
  if (!email || !configured()) return [];
  const rows = await sb("sites?owner_email=ilike." + encodeURIComponent(email) + "&order=created_at.asc");
  return (rows || []).map(shape);
}

async function getSiteByStripeCustomer(customerId) {
  if (!customerId || !configured()) return null;
  const rows = await sb("sites?stripe_customer_id=eq." + encodeURIComponent(customerId) + "&limit=1");
  return rows && rows.length ? shape(rows[0]) : null;
}

async function createSite(fields) {
  const rows = await sb("sites", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: [fields],
  });
  return shape(Array.isArray(rows) ? rows[0] : rows);
}

async function updateSite(id, patch) {
  const rows = await sb("sites?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: patch,
  });
  return shape(Array.isArray(rows) ? rows[0] : rows);
}

// Texts this site has used since the 1st of the month. Counts every message
// row on its conversations, both directions.
async function textsUsedThisMonth(siteId) {
  if (!configured()) return 0;
  try {
    const r = await sb(
      "messages?select=id,conversations!inner(site_id)" +
      "&conversations.site_id=eq." + encodeURIComponent(siteId) +
      "&created_at=gte." + encodeURIComponent(monthStart()),
      { headers: { Prefer: "count=exact", Range: "0-0" }, raw: true }
    );
    const cr = r.headers.get("content-range") || "";
    const total = parseInt(cr.split("/")[1], 10);
    return isNaN(total) ? 0 : total;
  } catch (err) {
    console.error("usage count failed:", err && err.message);
    return 0;
  }
}

// Make a URL-safe id from a business name, plus a short random tail so two
// "Aloha Plumbing"s never collide.
function makeSiteId(businessName) {
  const crypto = require("crypto");
  const base = String(businessName || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "site";
  return base + "-" + crypto.randomBytes(3).toString("hex");
}

module.exports = {
  DEFAULT_SITE_ID: DEFAULT_SITE_ID,
  getSite: getSite,
  getSiteByNumber: getSiteByNumber,
  getSiteForSharedInbound: getSiteForSharedInbound,
  getSitesByOwner: getSitesByOwner,
  getSiteByStripeCustomer: getSiteByStripeCustomer,
  createSite: createSite,
  updateSite: updateSite,
  textsUsedThisMonth: textsUsedThisMonth,
  makeSiteId: makeSiteId,
};
