// POST /api/lead  - self-serve signup. (Kept at this path so the landing page
// form and any old links keep working; it used to just email Borys.)
//
// Body: { business, email, phone, website, agentName }
//
// Creates a site on the free plan, emails the owner a sign-in link to the
// portal (where the install snippet lives), and alerts the admin. Returns the
// siteId and the one-line snippet so the page can show it immediately.

const { createSite, getSitesByOwner, makeSiteId } = require("../lib/sites");
const { makeLoginToken } = require("../lib/auth");
const { sendEmail } = require("../lib/notify");
const { saveTrialSignup } = require("../lib/store");

function baseUrl(req) {
  var host = req.headers["x-forwarded-host"] || req.headers.host || "www.textcatch.app";
  var proto = req.headers["x-forwarded-proto"] || "https";
  return proto + "://" + host;
}

function snippetFor(siteId) {
  return '<script src="https://www.textcatch.app/textcatch-widget.js" data-site="' + siteId + '" async></script>';
}

function normPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return "+" + digits;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const business = (body.business || body.businessName || "").toString().trim().slice(0, 60);
  const email = (body.email || "").toString().trim().toLowerCase().slice(0, 120);
  const website = (body.website || "").toString().trim().slice(0, 200);
  const agentName = (body.agentName || body.name || "").toString().trim().slice(0, 30);
  const phone = normPhone(body.phone);

  if (!business) return res.status(400).json({ error: "What is the business called?" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (!phone || phone.replace(/\D/g, "").length < 11) return res.status(400).json({ error: "Enter the mobile number that should receive lead alerts" });

  // Free plan = one site per email. A second signup from the same address
  // just re-sends the sign-in link for the site they already have.
  let site = null;
  try {
    const mine = await getSitesByOwner(email);
    if (mine.length) site = mine[0];
  } catch (err) {
    console.error("Signup owner lookup failed:", err && err.message);
  }

  let created = false;
  if (!site) {
    try {
      site = await createSite({
        id: makeSiteId(business),
        business_name: business,
        agent_name: agentName || null,
        owner_email: email,
        owner_phone: phone,
        website: website || null,
        plan: "free",
        branding: true,
      });
      created = true;
    } catch (err) {
      console.error("Signup create failed:", err && err.message);
      return res.status(502).json({ error: "Could not create your account. Try again in a minute." });
    }
  }

  // Legacy log of trial signups; harmless if the table is gone.
  try { await saveTrialSignup({ name: agentName || null, email: email, business: business, website: website || null }); } catch (e) {}

  const secret = process.env.PORTAL_SECRET;
  const link = secret
    ? baseUrl(req) + "/api/portal/verify?token=" + encodeURIComponent(makeLoginToken(email, secret))
    : baseUrl(req) + "/app";
  const snippet = snippetFor(site.id);

  const NL = String.fromCharCode(10);
  try {
    await sendEmail({
      to: [email],
      subject: created ? "Your TextCatch widget is ready" : "Sign in to TextCatch",
      text: (created ? "Welcome to TextCatch." : "Here is your sign-in link.") + NL + NL +
        "Paste this one line into your website, right before </body>:" + NL + NL + snippet + NL + NL +
        "Open your inbox and settings: " + link + NL + NL +
        "The link works once and expires in 15 minutes; request a new one from the sign-in page any time.",
      html: "<p>" + (created ? "Welcome to TextCatch." : "Here is your sign-in link.") + "</p>" +
        "<p>Paste this one line into your website, right before <code>&lt;/body&gt;</code>:</p>" +
        "<pre style=\"background:#f4f4f5;padding:12px;border-radius:8px;white-space:pre-wrap\">" +
        snippet.replace(/</g, "&lt;") + "</pre>" +
        "<p><a href=\"" + link + "\">Open your inbox and settings</a></p>" +
        "<p style=\"color:#666;font-size:13px\">The link works once and expires in 15 minutes; request a new one from the sign-in page any time.</p>",
    });
  } catch (err) {
    console.error("Signup email failed:", err && err.message);
  }

  // Admin alert. Never blocks the response.
  sendEmail({
    subject: (created ? "New signup: " : "Returning signup: ") + business,
    text: "Business: " + business + NL + "Email: " + email + NL + "Phone: " + phone + NL + "Website: " + (website || "-") + NL + "Site id: " + site.id,
    html: "<p><b>" + business + "</b><br>" + email + "<br>" + phone + "<br>" + (website || "-") + "<br>site: " + site.id + "</p>",
  }).catch(function (err) { console.error("Signup admin alert failed:", err && err.message); });

  return res.status(200).json({ ok: true, created: created, siteId: site.id, snippet: snippet, plan: site.planId });
};
