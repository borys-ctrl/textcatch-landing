// /api/site
//
//   GET  ?id=<siteId>        public widget config (name, colours, branding). No
//                            phone numbers or emails ever leave here.
//   GET  ?mine=1             (signed in) my sites with plan + usage
//   PATCH { siteId, ... }    (signed in) update agentName / businessName / accent

const { getSite, updateSite, textsUsedThisMonth } = require("../lib/sites");
const { requireSiteAccess } = require("../lib/auth");
const { PLANS } = require("../lib/plans");

function publicView(site) {
  return {
    siteId: site.id,
    businessName: site.businessName,
    agentName: site.agentName || site.businessName,
    accent: site.accent || "#16B57A",
    branding: site.plan.branding && site.branding,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.searchParams.get("id")) {
    const site = await getSite(url.searchParams.get("id"));
    if (!site) return res.status(404).json({ error: "Unknown site" });
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json(publicView(site));
  }

  if (req.method === "GET") {
    const access = await requireSiteAccess(req, res, null);
    if (!access) return;
    let list = access.all ? [] : (access.sites || []);
    if (access.all) {
      // Admin: every site. Cheap enough at this scale.
      const sites = require("../lib/sites");
      list = await sites.getSitesByOwner("%"); // ilike % = all
    }
    const out = [];
    for (const s of list) {
      const used = await textsUsedThisMonth(s.id);
      out.push({
        siteId: s.id, businessName: s.businessName, agentName: s.agentName, website: s.website,
        ownerEmail: s.ownerEmail, ownerPhone: s.ownerPhone, accent: s.accent,
        plan: s.planId, planName: s.plan.name, textsCap: s.plan.texts, textsUsed: used,
        number: s.twilioNumber || (process.env.TWILIO_PHONE_NUMBER || null), dedicated: !!s.twilioNumber,
        branding: s.plan.branding && s.branding,
        snippet: '<script src="https://www.textcatch.app/textcatch-widget.js" data-site="' + s.id + '" async></script>',
        createdAt: s.createdAt,
      });
    }
    return res.status(200).json({ ok: true, admin: !!access.all, email: access.session.e, sites: out, plans: PLANS });
  }

  if (req.method === "PATCH") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const access = await requireSiteAccess(req, res, (body.siteId || "").toString());
    if (!access || !access.site) return;
    const patch = {};
    if (typeof body.agentName === "string") patch.agent_name = body.agentName.trim().slice(0, 30) || null;
    if (typeof body.businessName === "string" && body.businessName.trim()) patch.business_name = body.businessName.trim().slice(0, 60);
    if (typeof body.ownerPhone === "string") {
      const d = body.ownerPhone.replace(/\D/g, "");
      if (d.length >= 10) patch.owner_phone = d.length === 10 ? "+1" + d : "+" + d;
    }
    if (typeof body.website === "string") patch.website = body.website.trim().slice(0, 200) || null;
    if (typeof body.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent)) patch.accent = body.accent;
    if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to change" });
    try {
      const s = await updateSite(access.site.id, patch);
      return res.status(200).json({ ok: true, site: publicView(s) });
    } catch (err) {
      console.error("Site update failed:", err && err.message);
      return res.status(502).json({ error: "Could not save" });
    }
  }

  res.setHeader("Allow", "GET, PATCH, OPTIONS");
  return res.status(405).json({ error: "Method not allowed" });
};
