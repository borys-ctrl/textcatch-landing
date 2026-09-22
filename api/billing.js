// /api/billing - Stripe, over plain fetch.
//
//   POST ?action=checkout  { siteId, plan }   (signed in) -> { url } Stripe Checkout
//   POST ?action=portal    { siteId }         (signed in) -> { url } Stripe billing portal
//   POST ?action=webhook                      Stripe -> us. Verifies the signature,
//                                             sets the plan, buys/releases numbers.
//
// Env:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
//   STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS  (price_...)

const crypto = require("crypto");
const { getSite, updateSite, getSiteByStripeCustomer } = require("../lib/sites");
const { requireSiteAccess } = require("../lib/auth");
const { getPlan, stripePriceId, planFromPriceId } = require("../lib/plans");
const twilio = require("../lib/twilio");

function baseUrl(req) {
  var host = req.headers["x-forwarded-host"] || req.headers.host || "www.textcatch.app";
  var proto = req.headers["x-forwarded-proto"] || "https";
  return proto + "://" + host;
}

async function stripe(path, params, method) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe not configured");
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: method || (params ? "POST" : "GET"),
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Stripe " + r.status + ": " + ((j.error && j.error.message) || "").slice(0, 300));
  return j;
}

// The raw body, needed byte-for-byte for the webhook signature. Vercel's
// helpers parse req.body lazily, so reading the stream first keeps it intact.
function readRaw(req) {
  return new Promise(function (resolve) {
    if (req.readableEnded || req.complete) {
      const b = req.body;
      return resolve(typeof b === "string" ? b : b ? JSON.stringify(b) : "");
    }
    const chunks = [];
    req.on("data", function (c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", function () { resolve(""); });
  });
}

function verifyStripe(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = {};
  header.split(",").forEach(function (kv) { const i = kv.indexOf("="); if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const expected = crypto.createHmac("sha256", secret).update(parts.t + "." + raw).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function applyPlan(site, planId, extra) {
  const patch = Object.assign({ plan: planId }, extra || {});
  const plan = getPlan(planId);
  if (plan.dedicatedNumber && !site.twilioNumber) {
    try {
      const bought = await twilio.buyNumber(twilio.areaCodeOf(site.ownerPhone));
      patch.twilio_number = bought.phoneNumber;
      console.log("Bought number", bought.phoneNumber, "for", site.id);
    } catch (err) {
      console.error("Number purchase failed for", site.id, err && err.message);
    }
  }
  if (!plan.dedicatedNumber && site.twilioNumber) {
    try { await twilio.releaseNumber(site.twilioNumber); patch.twilio_number = null; }
    catch (err) { console.error("Number release failed for", site.id, err && err.message); }
  }
  return updateSite(site.id, patch);
}

async function handleWebhook(req, res) {
  const raw = await readRaw(req);
  if (!verifyStripe(raw, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET)) {
    console.error("Stripe webhook: bad signature");
    return res.status(400).json({ error: "Bad signature" });
  }
  let event; try { event = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: "Bad JSON" }); }
  const obj = event.data && event.data.object || {};

  try {
    if (event.type === "checkout.session.completed") {
      const siteId = obj.metadata && obj.metadata.siteId;
      const site = siteId ? await getSite(siteId) : null;
      if (!site) { console.error("Checkout for unknown site", siteId); return res.status(200).json({ ok: true, ignored: true }); }
      const sub = obj.subscription ? await stripe("subscriptions/" + obj.subscription) : null;
      const priceId = sub && sub.items && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;
      const planId = planFromPriceId(priceId) || (obj.metadata && obj.metadata.plan) || "starter";
      await applyPlan(site, planId, { stripe_customer_id: obj.customer || null, stripe_subscription_id: obj.subscription || null });
    } else if (event.type === "customer.subscription.updated") {
      const site = await getSiteByStripeCustomer(obj.customer);
      if (site) {
        const priceId = obj.items && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
        const planId = planFromPriceId(priceId);
        const active = ["active", "trialing", "past_due"].indexOf(obj.status) >= 0;
        if (planId && active) await applyPlan(site, planId, { stripe_subscription_id: obj.id });
        if (!active && obj.status === "canceled") await applyPlan(site, "free", { stripe_subscription_id: null });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const site = await getSiteByStripeCustomer(obj.customer);
      if (site) await applyPlan(site, "free", { stripe_subscription_id: null });
    }
  } catch (err) {
    console.error("Stripe webhook handling failed:", event.type, err && err.message);
    return res.status(500).json({ error: "Handler failed" });
  }
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "";
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (action === "webhook") return handleWebhook(req, res);

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const access = await requireSiteAccess(req, res, (body.siteId || "").toString());
  if (!access || !access.site) return;
  const site = access.site;

  try {
    if (action === "checkout") {
      const planId = String(body.plan || "");
      const price = stripePriceId(planId);
      if (!price || planId === "free") return res.status(400).json({ error: "Pick a paid plan" });
      const params = {
        mode: "subscription",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        success_url: baseUrl(req) + "/app?upgraded=" + planId,
        cancel_url: baseUrl(req) + "/app",
        "metadata[siteId]": site.id,
        "metadata[plan]": planId,
        "subscription_data[metadata][siteId]": site.id,
        allow_promotion_codes: "true",
      };
      if (site.stripeCustomerId) params.customer = site.stripeCustomerId;
      else params.customer_email = site.ownerEmail || access.session.e;
      const session = await stripe("checkout/sessions", params);
      return res.status(200).json({ ok: true, url: session.url });
    }
    if (action === "portal") {
      if (!site.stripeCustomerId) return res.status(400).json({ error: "No subscription yet" });
      const p = await stripe("billing_portal/sessions", { customer: site.stripeCustomerId, return_url: baseUrl(req) + "/app" });
      return res.status(200).json({ ok: true, url: p.url });
    }
    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("Billing failed:", action, err && err.message);
    return res.status(502).json({ error: "Billing is unavailable right now" });
  }
};
