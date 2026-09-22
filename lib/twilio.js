// Twilio, over plain fetch. Every SMS goes out through the one approved
// Messaging Service (MessagingServiceSid), so any number attached to it is
// covered by the registered A2P brand and campaign - the shared TextCatch
// number and every dedicated customer number alike.
//
// Env:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   - required
//   TWILIO_PHONE_NUMBER                     - the shared number (free plan)
//   TWILIO_MESSAGING_SERVICE_SID            - MG... ; strongly recommended
//   TWILIO_SMS_WEBHOOK                      - inbound URL for bought numbers
//                                             (default https://www.textcatch.app/api/sms)

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("SMS not configured");
  return { sid: sid, auth: "Basic " + Buffer.from(sid + ":" + token).toString("base64") };
}

async function call(url, params, method) {
  const c = creds();
  const r = await fetch(url, {
    method: method || "POST",
    headers: { Authorization: c.auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error("Twilio " + r.status + ": " + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

async function sendSms(opts) {
  const c = creds();
  const params = { To: opts.to, Body: opts.body };
  const ms = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (opts.from) params.From = opts.from;
  if (ms) params.MessagingServiceSid = ms;
  if (!params.From && !ms) params.From = process.env.TWILIO_PHONE_NUMBER;
  if (!params.From && !ms) throw new Error("No sender configured");
  return call("https://api.twilio.com/2010-04-01/Accounts/" + c.sid + "/Messages.json", params);
}

// Buy a local number, preferring the owner's area code, and attach it to the
// Messaging Service so it inherits the approved campaign and inbound webhook.
async function buyNumber(preferredAreaCode) {
  const c = creds();
  const base = "https://api.twilio.com/2010-04-01/Accounts/" + c.sid;
  const search = async function (area) {
    const q = "SmsEnabled=true&Limit=1" + (area ? "&AreaCode=" + area : "");
    const r = await fetch(base + "/AvailablePhoneNumbers/US/Local.json?" + q, { headers: { Authorization: c.auth } });
    if (!r.ok) throw new Error("Twilio search " + r.status + ": " + (await r.text()).slice(0, 200));
    const j = await r.json();
    return (j.available_phone_numbers || [])[0];
  };
  let found = preferredAreaCode ? await search(preferredAreaCode) : null;
  if (!found) found = await search(null);
  if (!found) throw new Error("No numbers available");

  const params = {
    PhoneNumber: found.phone_number,
    SmsUrl: process.env.TWILIO_SMS_WEBHOOK || "https://www.textcatch.app/api/sms",
    SmsMethod: "POST",
    FriendlyName: "TextCatch customer",
  };
  const bought = await call(base + "/IncomingPhoneNumbers.json", params);

  const ms = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (ms) {
    try {
      await call("https://messaging.twilio.com/v1/Services/" + ms + "/PhoneNumbers", { PhoneNumberSid: bought.sid });
    } catch (err) {
      console.error("Could not attach number to Messaging Service:", err && err.message);
    }
  }
  return { phoneNumber: bought.phone_number, sid: bought.sid };
}

async function releaseNumber(phoneNumber) {
  const c = creds();
  const base = "https://api.twilio.com/2010-04-01/Accounts/" + c.sid;
  const r = await fetch(base + "/IncomingPhoneNumbers.json?PhoneNumber=" + encodeURIComponent(phoneNumber), { headers: { Authorization: c.auth } });
  if (!r.ok) throw new Error("Twilio lookup " + r.status);
  const j = await r.json();
  const num = (j.incoming_phone_numbers || [])[0];
  if (!num) return { skipped: true };
  await call(base + "/IncomingPhoneNumbers/" + num.sid + ".json", null, "DELETE");
  return { ok: true };
}

function areaCodeOf(e164) {
  const m = String(e164 || "").replace(/\D/g, "").match(/^1?(\d{3})\d{7}$/);
  return m ? m[1] : null;
}

module.exports = { sendSms: sendSms, buyNumber: buyNumber, releaseNumber: releaseNumber, areaCodeOf: areaCodeOf };
