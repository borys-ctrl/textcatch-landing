const { getSite } = require("./sites");
const { saveLead } = require("./store");
const { sendLeadEmail } = require("./notify");

// Vercel serverless function: receives the chat widget's lead POST and sends two
// SMS via Twilio — #1 a confirmation to the visitor, #2 a lead alert to the owner.
// All credentials come from env vars (never hardcoded):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, OWNER_PHONE_NUMBER

async function sendSms({ sid, token, from, to, body }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Twilio ${r.status}: ${detail}`);
  }
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    console.error("Twilio env vars missing", {
      sid: !!sid, token: !!token, from: !!from,
    });
    return res.status(500).json({ error: "SMS not configured" });
  }

  // Body may already be parsed (Vercel does this for JSON), or arrive as a string.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // Widget sends firstName; accept name too for robustness. phone is already
  // E.164-normalized client-side (+1XXXXXXXXXX).
  const name = (body.firstName || body.name || "").toString().trim();
  const phone = (body.phone || "").toString().trim();
  const email = (body.email || "").toString().trim();
  const comment = (body.comment || "").toString().trim();
  const smsConsent = body.smsConsent === true;
  // Resolve which customer this lead belongs to. The widget sends a siteId;
  // sites.js maps it to that business name and the phone to alert. We do NOT
  // trust a client-supplied business name — it is display text on the SMS.
  const site = getSite(body.siteId);
  if (!site) {
    console.error("Unknown siteId", body.siteId);
    return res.status(400).json({ error: "Unknown site" });
  }
  const businessName = site.businessName.slice(0, 25);
  const owner = site.ownerPhone;

  if (!phone) {
    return res.status(400).json({ error: "Missing phone number" });
  }

  const greetName = name || "there";

  // #1 -> visitor (confirmation). Deliberately held to a single 160-char
  // GSM-7 segment. The visitor's question is no longer echoed back: it made
  // the message variable-length (often 2-3 segments) and produced doubled
  // punctuation such as "Wix site?.". The owner alert still carries it.
  const safeName = greetName.slice(0, 12);
  const visitorMsg =
    `Hi ${safeName}, thanks for contacting ${businessName}! ` +
    `We'll reply shortly. ` +
    `Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;

  // #2 → owner (lead alert). Copy per CLAUDE.md.
  const ownerMsg =
    `New lead:\n` +
    `${name || "—"}\n` +
    `${phone}\n` +
    `${email || "—"}\n` +
    `${comment || "—"}`;

  // Only send visitor confirmation SMS if they opted in; always alert the owner.
  const visitorPromise = smsConsent
    ? sendSms({ sid, token, from, to: phone, body: visitorMsg })
    : Promise.resolve({ skipped: true, reason: "no SMS consent" });

  // Persist the lead. Runs alongside the sends rather than before them so a
  // slow or broken lead log can never delay or block the customer alert.
  const savePromise = saveLead({
    site_id: site.id,
    name: name || null,
    phone: phone,
    email: email || null,
    comment: comment || null,
    sms_consent: smsConsent,
    page_url: (body.pageUrl || "").toString().slice(0, 500) || null,
  });

  // Email the owner too, so leads land in the inbox as well as the phone.
  const emailPromise = sendLeadEmail({
    siteId: site.id,
    businessName: businessName,
    name: name,
    phone: phone,
    email: email,
    comment: comment,
    smsConsent: smsConsent,
  });

  const [visitorRes, ownerRes, saveRes, emailRes] = await Promise.allSettled([
    visitorPromise,
    sendSms({ sid, token, from, to: owner, body: ownerMsg }),
    savePromise,
    emailPromise,
  ]);

  if (visitorRes.status === "rejected") {
    console.error("Visitor SMS failed:", visitorRes.reason?.message);
  }
  if (ownerRes.status === "rejected") {
    console.error("Owner SMS failed:", ownerRes.reason?.message);
  }
  if (emailRes.status === "rejected") {
    console.error("Lead email failed:", emailRes.reason?.message);
  }
  if (saveRes.status === "rejected") {
    // Lead still reached the owner by text; surface this so it can be backfilled.
    console.error("Lead save failed:", saveRes.reason?.message);
  }

  // If both failed, surface an error. If only one failed, the lead is still
  // captured (owner alert is the critical leg) — log it but return ok.
  if (visitorRes.status === "rejected" && ownerRes.status === "rejected") {
    return res.status(502).json({ error: "Failed to send SMS" });
  }

  return res.status(200).json({
    ok: true,
    visitorSms: smsConsent && visitorRes.status === "fulfilled",
    ownerSms: ownerRes.status === "fulfilled",
    saved: saveRes.status === "fulfilled" && !saveRes.value?.skipped,
    emailed: emailRes.status === "fulfilled" && !emailRes.value?.skipped,
  });
};
