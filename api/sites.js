// Tenant registry. One entry per site running the TextCatch widget.
//
// The widget posts a siteId with every lead; the backend looks it up here to
// decide which business the lead belongs to and which phone to alert. Adding a
// customer = adding a row here + handing them a snippet with their siteId.
//
// Phone numbers live in env vars so real numbers never sit in the repo.
// For each site FOO, set OWNER_PHONE_FOO in the Vercel project settings.

const SITES = {
  textcatch: {
    businessName: "TextCatch",
    ownerPhoneEnv: "OWNER_PHONE_TEXTCATCH",
  },
  bfh: {
    businessName: "Best Flooring Honolulu",
    ownerPhoneEnv: "OWNER_PHONE_BFH",
  },
};

// Used when a lead arrives with no siteId — keeps existing installs working.
const DEFAULT_SITE_ID = "textcatch";

/**
 * Resolve a siteId to its config, or null if unknown.
 * Falls back to OWNER_PHONE_NUMBER so the original single-tenant env var
 * keeps working while we migrate.
 */
function getSite(siteId) {
  const id = (siteId || DEFAULT_SITE_ID).toString().trim().toLowerCase();
  const site = SITES[id];
  if (!site) return null;

  const phone = process.env[site.ownerPhoneEnv] || process.env.OWNER_PHONE_NUMBER || "";
  if (!phone) return null;

  return { id: id, businessName: site.businessName, ownerPhone: phone };
}

module.exports = { SITES: SITES, DEFAULT_SITE_ID: DEFAULT_SITE_ID, getSite: getSite };
