// The four plans. One place, imported by billing, chat and the portal, so the
// pricing page, the usage cap and Stripe can never disagree about a number.
//
// texts = inbound + outbound SMS per calendar month, across all of a site's
// conversations. dedicatedNumber = the site gets its own Twilio number; free
// sites text from the shared TextCatch number. branding = the widget shows
// "Powered by TextCatch".

const PLANS = {
  free:     { name: "Free",     price: 0,     texts: 30,   sites: 1,  dedicatedNumber: false, branding: true  },
  starter:  { name: "Starter",  price: 9.99,  texts: 200,  sites: 1,  dedicatedNumber: true,  branding: true  },
  pro:      { name: "Pro",      price: 29.99, texts: 1000, sites: 3,  dedicatedNumber: true,  branding: false },
  business: { name: "Business", price: 99.99, texts: 5000, sites: 10, dedicatedNumber: true,  branding: false },
};

const ORDER = ["free", "starter", "pro", "business"];

// Stripe Price ids live in env so test and live keys can differ.
function stripePriceId(plan) {
  return process.env["STRIPE_PRICE_" + String(plan || "").toUpperCase()] || null;
}

function planFromPriceId(priceId) {
  if (!priceId) return null;
  return ORDER.find(function (p) { return stripePriceId(p) === priceId; }) || null;
}

function getPlan(id) {
  return PLANS[id] || PLANS.free;
}

// First day of the current month, UTC, as an ISO string - the usage window.
function monthStart(d) {
  const now = d || new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

module.exports = { PLANS: PLANS, ORDER: ORDER, getPlan: getPlan, stripePriceId: stripePriceId, planFromPriceId: planFromPriceId, monthStart: monthStart };
