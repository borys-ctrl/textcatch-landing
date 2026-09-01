const crypto = require("crypto");
const { getSite } = require("./sites");
const { findOrCreateConversation, saveMessage } = require("./store");
const { sendInboundSmsEmail } = require("./notify");

// Vercel serverless function: Twilio's "A message comes in" webhook for the
// TextCatch number.
//
// Before this existed, a lead who replied to our confirmation text was talking
// to nobody: Twilio accepted the message and it went nowhere. Every inbound
// message now lands in `messages`, attached to a conversation, and is emailed
// out with a per-conversation Reply-To so it can be answered from a phone.
//
// Point Twilio at:  https://textcatch.app/api/sms   (HTTP POST)
//
// Env:
//   TWILIO_AUTH_TOKEN     - required, used to prove the request is really Twilio
//   TWILIO_WEBHOOK_URL    - optional, exact public URL if host detection is wrong
//   ALLOW_UNSIGNED_SMS    - "1" to skip signature checks. Local testing only.

// Twilio signs: the full URL, then every POST param appended as key+value in
// alphabetical order, HMAC-SHA1 with the auth token, base64.
function expectedSignature(authToken, url, params) {
  let data = url;
  Object.keys(params || {})
    .sort()
    .forEach(function (k) {
      data += k + (params[k] == null ? "" : params[k]);
    });
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  // timingSafeEqual throws on length mismatch, which itself leaks nothing here
  // because the signature length is fixed and public.
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Vercel terminates TLS upstream, so req.url has no origin and the protocol
// lives in a header. www and apex both serve this app and Twilio signs
// whichever one it was configured with, so we accept either.
function candidateUrls(req) {
  if (process.env.TWILIO_WEBHOOK_URL) return [process.env.TWILIO_WEBHOOK_URL];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const path = req.url || "/api/sms";
  const urls = [proto + "://" + host + path];
  if (host.startsWith("www.")) urls.push(proto + "://" + host.slice(4) + path);
  else urls.push(proto + "://www." + host + path);
  return urls;
}

function isFromTwilio(req, params) {
  if (process.env.ALLOW_UNSIGNED_SMS === "1") return true;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers["x-twilio-signature"];
  if (!token || !sig) return false;
  return candidateUrls(req).some(function (u) {
    return safeEqual(expectedSignature(token, u, params), sig);
  });
}

// Twilio wants XML back. An empty Response means "received, send nothing" —
// we deliberately do not auto-reply, because a human is going to answer.
function emptyTwiml(res) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Twilio posts application/x-www-form-urlencoded. Vercel usually parses it;
  // fall back to manual parsing so a config change cannot silently break this.
  let params = req.body;
  if (typeof params === "string") {
    params = Object.fromEntries(new URLSearchParams(params));
  }
  params = params || {};

  if (!isFromTwilio(req, params)) {
    console.error("Rejected inbound SMS: bad or missing Twilio signature");
    return res.status(403).json({ error: "Invalid signature" });
  }

  const from = (params.From || "").toString().trim();
  const to = (params.To || "").toString().trim();
  const body = (params.Body || "").toString();
  const sid = (params.MessageSid || params.SmsSid || "").toString().trim();

  if (!from) {
    console.error("Inbound SMS with no From", sid);
    return emptyTwiml(res);
  }

  // Which customer's number was texted. Single number today, so the default
  // site is correct; when customers get their own numbers this maps To -> site.
  const site = getSite(process.env.INBOUND_SITE_ID) || getSite(null);
  const siteId = site ? site.id : "textcatch";

  // Never let a storage or email problem cause a non-200: Twilio would retry,
  // and a retry storm on a broken database helps nobody. Log and move on.
  //
  // Storage and email are attempted INDEPENDENTLY on purpose. Supabase pausing
  // must not also cost the notification - that combination would make an
  // inbound text vanish silently, which is the exact bug this file exists to
  // fix. Without a conversation id the email says so and cannot be replied to,
  // but it still arrives.
  let convo = null;
  try {
    convo = await findOrCreateConversation(siteId, from, null);
    if (convo && !convo.skipped && convo.id) {
      await saveMessage({
        conversation_id: convo.id,
        direction: "inbound",
        body: body,
        from_number: from,
        to_number: to,
        twilio_sid: sid || null,
      });
    } else {
      console.error("Inbound SMS not stored, storage unavailable", { sid: sid, from: from });
    }
  } catch (err) {
    console.error("Inbound SMS storage failed:", err && err.message, { sid: sid, from: from });
  }

  try {
    await sendInboundSmsEmail({
      conversationId: convo && convo.id,
      from: from,
      name: convo && convo.lead_name,
      body: body,
    });
  } catch (err) {
    console.error("Inbound SMS email failed:", err && err.message, { sid: sid, from: from });
  }

  return emptyTwiml(res);
};

module.exports.expectedSignature = expectedSignature;
module.exports.candidateUrls = candidateUrls;
