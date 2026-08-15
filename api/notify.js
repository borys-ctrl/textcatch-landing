// Email notifications, shared by every inbound path.
//
// Sends from hello@textcatch.app, a domain verified in the textcatchapp
// Resend account. Key comes from the resend_textcatch env var.
//
// No-ops rather than throwing when unconfigured: a missing email must never
// cost us a lead that already arrived by text or landed in the database.

const NL = String.fromCharCode(10);
const FROM = "TextCatch <hello@textcatch.app>";
const TO = ["textcatchapp@gmail.com"];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

async function sendEmail(opts) {
  const apiKey = process.env.resend_textcatch;
  if (!apiKey) return { skipped: true, reason: "email not configured" };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      reply_to: opts.replyTo || undefined,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error("Resend " + r.status + ": " + detail);
  }
  return { ok: true };
}

// A lead captured by the chat widget on a customer site.
function sendLeadEmail(lead) {
  const who = lead.businessName || lead.siteId || "unknown site";
  const subject = "New lead: " + (lead.name || "unknown") + " - " + who;

  const rows = [
    ["Site", who],
    ["Name", lead.name || "-"],
    ["Phone", lead.phone || "-"],
    ["Email", lead.email || "-"],
    ["Asked", lead.comment || "-"],
    ["SMS consent", lead.smsConsent ? "yes" : "no"],
  ];

  const html = "<h2>New lead from the chat widget</h2><table cellpadding=6>" +
    rows.map(function (r) {
      return "<tr><td><strong>" + esc(r[0]) + "</strong></td><td>" + esc(r[1]) + "</td></tr>";
    }).join("") + "</table>";

  const text = "New lead from the chat widget" + NL +
    rows.map(function (r) { return r[0] + ": " + r[1]; }).join(NL);

  return sendEmail({
    subject: subject,
    html: html,
    text: text,
    replyTo: lead.email || undefined,
  });
}

module.exports = { sendEmail: sendEmail, sendLeadEmail: sendLeadEmail };
