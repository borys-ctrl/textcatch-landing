// Email notifications, shared by every inbound path.
//
// Sends from hello@textcatch.app, a domain verified in the textcatchapp
// Resend account. Key comes from the resend_textcatch env var.
//
// No-ops rather than throwing when unconfigured: a missing email must never
// cost us a lead that already arrived by text or landed in the database.

const NL = String.fromCharCode(10);
const FROM = "TextCatch <hello@textcatch.app>";
// Replies come back to the mailbox itself rather than a new inbound-email
// subdomain: no MX records, no extra vendor, and an Apps Script already runs
// in this mailbox for reply forwarding. The conversation id travels in the
// subject as [TC-<id>], which is what the relay matches on.
const REPLY_MAILBOX = process.env.REPLY_MAILBOX || "textcatchapp@gmail.com";
// Default recipient for lead and inbound-text notifications. Callers can
// override with opts.to - the portal sign-in link, for instance, must go to
// the person signing in rather than to the shared alerts mailbox.
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
      to: opts.to || TO,
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

// An inbound text from a lead, arriving at the TextCatch number.
//
// Reply-To is per-conversation: replying to this email in Gmail on a phone is
// what sends the text back. That address is what the relay looks for, so it
// must stay stable and must not be prettified.
function sendInboundSmsEmail(msg) {
  const who = msg.name || msg.from || "unknown number";
  const preview = (msg.body || "").replace(/\s+/g, " ").trim().slice(0, 60);

  // The [TC-<id>] tag is load-bearing: the email-to-SMS relay reads it to know
  // which conversation a reply belongs to. Gmail keeps it through "Re:", so it
  // survives however many times the thread goes back and forth.
  const tag = msg.conversationId ? "[TC-" + msg.conversationId + "] " : "";
  const subject = tag + "Text from " + who + (preview ? ": " + preview : "");

  const rows = [
    ["From", msg.from || "-"],
    ["Name", msg.name || "-"],
    ["Message", msg.body || "-"],
  ];

  const note = msg.conversationId
    ? "Reply to this email and your answer goes to them as a text from the TextCatch number. Everything above the quoted line is sent; keep it short."
    : "Storage was unavailable, so replying to this email will NOT reach them. The message is above - answer it another way.";

  const html = "<h2>New text from " + esc(who) + "</h2><table cellpadding=6>" +
    rows.map(function (r) {
      return "<tr><td><strong>" + esc(r[0]) + "</strong></td><td>" + esc(r[1]) + "</td></tr>";
    }).join("") + "</table><p>" + esc(note) + "</p>";

  const text = "New text from " + who + NL +
    rows.map(function (r) { return r[0] + ": " + r[1]; }).join(NL) + NL + NL + note;

  return sendEmail({
    subject: subject,
    html: html,
    text: text,
    replyTo: msg.conversationId ? REPLY_MAILBOX : undefined,
  });
}

module.exports = {
  sendEmail: sendEmail,
  sendLeadEmail: sendLeadEmail,
  sendInboundSmsEmail: sendInboundSmsEmail,
};
