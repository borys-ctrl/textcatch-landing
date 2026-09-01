const { saveTrialSignup, findOrCreateConversation, saveMessage } = require("./store");
const { notifyDevices } = require("./webpush");

// Vercel serverless function: receives the trial-form POST from the landing
// page. Saves the signup to Supabase first, then emails an alert via Resend.
//
// Credentials come from env vars (never hardcoded):
//   resend_textcatch  API key for the textcatchapp Resend account
//   SUPABASE_URL / SUPABASE_SERVICE_KEY  used by ./store

// textcatch.app is verified in Resend, so we can send from it to anyone.
const TO = ["textcatchapp@gmail.com", "borys@bestflooringhonolulu.com"];
// Resend's shared sender works without verifying a domain, but only delivers to
// the Resend account owner's address — fine for this smoke test. Swap this for an
// address on a verified domain once you have one.
const FROM = "TextCatch <hello@textcatch.app>";

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

  // Belongs to the textcatchapp Resend account, which owns the verified
  // textcatch.app domain we send from. Lowercase name matches Vercel.
  const apiKey = process.env.resend_textcatch;
  if (!apiKey) {
    console.error("resend_textcatch is not set");
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
  const phoneRaw = (body.phone || "").toString().trim();
  const smsConsent = body.smsConsent === true;

  if (!name && !email && !business) {
    return res.status(400).json({ error: "Empty submission" });
  }

  // Same normalisation the widget uses, so a number typed as (808) 555-0148
  // here and +18085550148 there resolve to one conversation rather than two.
  const digits = phoneRaw.replace(/\D/g, "");
  const phone = !digits ? ""
    : digits.length === 10 ? "+1" + digits
    : digits.length === 11 && digits[0] === "1" ? "+" + digits
    : "+" + digits;

  const html = `
    <h2>New lead at TextCatch</h2>
    <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(name) || "—"}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(email) || "—"}</td></tr>
      <tr><td><strong>Business</strong></td><td>${escapeHtml(business) || "—"}</td></tr>
      <tr><td><strong>Phone</strong></td><td>${escapeHtml(phoneRaw) || "—"}</td></tr>
      <tr><td><strong>Website</strong></td><td>${escapeHtml(website) || "—"}</td></tr>
    </table>`;

  const text =
    `New lead at TextCatch\n\n` +
    `Name: ${name || "—"}\n` +
    `Email: ${email || "—"}\n` +
    `Business: ${business || "—"}\n` +
    `Phone: ${phoneRaw || "—"}\n` +
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
  // A form signup should reach the portal exactly like a widget lead, so both
  // roads lead to one inbox. Needs a phone number: conversations are keyed on
  // it, and without one there is nobody to text back.
  if (phone && phone.replace(/\D/g, "").length >= 11) {
    try {
      const convo = await findOrCreateConversation("textcatch", phone, name || null);
      if (convo && !convo.skipped && convo.id) {
        await saveMessage({
          conversation_id: convo.id,
          direction: "inbound",
          body:
            "Asked for a trial via the form." +
            (business ? " Business: " + business + "." : "") +
            (website ? " Site: " + website + "." : "") +
            (email ? " Email: " + email + "." : "") +
            (smsConsent ? " Agreed to be texted." : " Did NOT tick the text consent box."),
          from_number: phone,
          to_number: process.env.TWILIO_PHONE_NUMBER || null,
          twilio_sid: null,
        });
      }
    } catch (err) {
      // The signup is already saved and the alert still goes out; only the
      // portal thread is missing, so this must not fail the submission.
      console.error("Trial signup thread failed:", err.message);
    }

    // Buzz the phone once the thread exists. Someone who filled in a form is
    // every bit as warm as someone who texted, and until now the form was the
    // one path that only produced an email.
    try {
      const pushed = await notifyDevices();
      if (pushed && pushed.error) console.error("Form lead push:", pushed.error);
    } catch (err) {
      console.error("Form lead push failed:", err && err.message);
    }
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
      // The alert failed, but if the signup is in the database it is not lost.
      // Only surface an error to the visitor when we have kept nothing at all.
      if (stored) return res.status(200).json({ ok: true, emailed: false });
      return res.status(502).json({ error: "Failed to send email" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Lead handler error", err);
    return res.status(500).json({ error: "Unexpected error" });
  }
};
