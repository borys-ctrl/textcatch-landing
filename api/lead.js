const { saveTrialSignup } = require("./store");

// Vercel serverless function: receives the trial-form POST and emails the lead
// to borys@bestflooringhonolulu.com via Resend. The Resend API key is read from
// the RESEND_API_KEY environment variable (never hardcode it).

// Both inboxes: the flooring address is where Resend can deliver from its
// shared sender, and textcatchapp is where prospect replies already land.
const TO = ["borys@bestflooringhonolulu.com", "textcatchapp@gmail.com"];
// Resend's shared sender works without verifying a domain, but only delivers to
// the Resend account owner's address — fine for this smoke test. Swap this for an
// address on a verified domain once you have one.
const FROM = "TextCatch Leads <onboarding@resend.dev>";

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set");
    return res.status(500).json({ error: "Email not configured" });
  }

  // Body may already be parsed (Vercel does this for JSON), or arrive as a string.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const name = (body.name || "").toString().trim();
  const email = (body.email || "").toString().trim();
  const business = (body.business || "").toString().trim();
  const website = (body.website || "").toString().trim();

  if (!name && !email && !business) {
    return res.status(400).json({ error: "Empty submission" });
  }

  const html = `
    <h2>New lead at TextCatch</h2>
    <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(name) || "—"}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(email) || "—"}</td></tr>
      <tr><td><strong>Business</strong></td><td>${escapeHtml(business) || "—"}</td></tr>
      <tr><td><strong>Website</strong></td><td>${escapeHtml(website) || "—"}</td></tr>
    </table>`;

  const text =
    `New lead at TextCatch\n\n` +
    `Name: ${name || "—"}\n` +
    `Email: ${email || "—"}\n` +
    `Business: ${business || "—"}\n` +
    `Website: ${website || "—"}\n`;

  // Persist first. A signup that reaches the database but not the inbox is
  // recoverable; one that only ever existed as an email is not.
  let stored = false;
  try {
    const res = await saveTrialSignup({ name: name || null, email: email || null,
                                        business: business || null, website: website || null });
    stored = !res.skipped;
  } catch (err) {
    console.error("Trial signup save failed:", err.message);
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        reply_to: email || undefined,
        subject: "New lead at textcatch",
        html,
        text,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("Resend error", r.status, detail);
      return res.status(502).json({ error: "Failed to send email" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Lead handler error", err);
    return res.status(500).json({ error: "Unexpected error" });
  }
};
