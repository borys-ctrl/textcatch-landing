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
  const owner = process.env.OWNER_PHONE_NUMBER;
  if (!sid || !token || !from || !owner) {
    console.error("Twilio env vars missing", {
      sid: !!sid, token: !!token, from: !!from, owner: !!owner,
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

  if (!phone) {
    return res.status(400).json({ error: "Missing phone number" });
  }

  const greetName = name || "there";

  // #1 → visitor (confirmation). Copy per CLAUDE.md.
  const visitorMsg =
    `Good day, ${greetName}. Thank you for contacting textcatch.app. ` +
    `We received your question: ${comment || "(no message)"}. ` +
    `You'll hear from us soon.`;

  // #2 → owner (lead alert). Copy per CLAUDE.md.
  const ownerMsg =
    `New lead:\n` +
    `${name || "—"}\n` +
    `${phone}\n` +
    `${email || "—"}\n` +
    `${comment || "—"}`;

  // Send both. Don't let a bad visitor number block the owner alert.
  const [visitorRes, ownerRes] = await Promise.allSettled([
    sendSms({ sid, token, from, to: phone, body: visitorMsg }),
    sendSms({ sid, token, from, to: owner, body: ownerMsg }),
  ]);

  if (visitorRes.status === "rejected") {
    console.error("Visitor SMS failed:", visitorRes.reason?.message);
  }
  if (ownerRes.status === "rejected") {
    console.error("Owner SMS failed:", ownerRes.reason?.message);
  }

  // If both failed, surface an error. If only one failed, the lead is still
  // captured (owner alert is the critical leg) — log it but return ok.
  if (visitorRes.status === "rejected" && ownerRes.status === "rejected") {
    return res.status(502).json({ error: "Failed to send SMS" });
  }

  return res.status(200).json({
    ok: true,
    visitorSms: visitorRes.status === "fulfilled",
    ownerSms: ownerRes.status === "fulfilled",
  });
};
