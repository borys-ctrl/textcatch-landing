// Who may be texted from the portal.
//
// One rule, used in two places: the threads list (to hide the Send box and say
// why) and the reply endpoint (to refuse the send outright). The server check
// is the one that matters; the app only explains it.
//
//   1. If they texted STOP (or similar) and have not texted START since: no.
//      Carriers already block this, but we say so plainly instead of letting
//      the send fail with a cryptic Twilio error.
//   2. If they texted the number themselves: yes. Someone who texts you can
//      be texted back.
//   3. Otherwise the thread came from the chat widget. Use the consent box on
//      their most recent submission. Ticked: yes. Not ticked: no.
//   4. No record at all: no. When in doubt, do not text.
//
// Pure functions only - no database access - so the rule can be tested
// without a network.

var OPT_OUT = ["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "OPT OUT", "REVOKE"];
var OPT_IN = ["START", "UNSTOP", "YES", "OPTIN", "OPT IN"];

// Carriers match the whole message as a keyword, ignoring case and trailing
// punctuation. "Stop." is an opt-out; "please stop calling me" is not.
function keyword(body) {
  return String(body == null ? "" : body)
    .trim()
    .toUpperCase()
    .replace(/[\s.!]+$/g, "")
    .replace(/\s+/g, " ");
}

function ts(x) {
  var t = Date.parse((x && (x.created_at || x.at)) || "");
  return isNaN(t) ? 0 : t;
}

function latestLead(leads) {
  return (leads || []).slice().sort(function (a, b) {
    return (ts(b) - ts(a)) || ((b && b.id || 0) - (a && a.id || 0));
  })[0] || null;
}

// messages: rows with direction, body, twilio_sid, created_at (or at)
// leads:    rows from the `leads` table for this site + phone
// Returns { canReply: boolean, reason: string|null }
function replyPermission(messages, leads) {
  // A real text has a Twilio message id. What someone typed into the chat
  // widget is stored as an inbound message too, but without one.
  var texts = (messages || [])
    .filter(function (m) { return m && m.direction === "inbound" && m.twilio_sid; })
    .sort(function (a, b) { return ts(a) - ts(b); });

  var optedOut = false;
  texts.forEach(function (m) {
    var k = keyword(m.body);
    if (OPT_OUT.indexOf(k) !== -1) optedOut = true;
    else if (OPT_IN.indexOf(k) !== -1) optedOut = false;
  });
  if (optedOut) {
    return { canReply: false, reason: "They texted STOP. You can't text them unless they text START." };
  }

  if (texts.length) return { canReply: true, reason: null };

  var lead = latestLead(leads);
  if (lead && lead.sms_consent === true) return { canReply: true, reason: null };

  if (lead) {
    var email = lead.email ? String(lead.email).trim() : "";
    return {
      canReply: false,
      reason: "They did not agree to texts on the chat form." +
        (email ? " Reply by email: " + email : " They left no email."),
    };
  }

  return { canReply: false, reason: "No record that they agreed to texts." };
}

// PostgREST `in.(...)` list. Values are quoted because phone numbers start
// with "+", which would otherwise be read as a space in a URL.
function inList(values) {
  return "(" + (values || []).map(function (v) {
    return encodeURIComponent('"' + String(v).replace(/["\\]/g, "") + '"');
  }).join(",") + ")";
}

module.exports = {
  replyPermission: replyPermission,
  keyword: keyword,
  inList: inList,
  OPT_OUT: OPT_OUT,
  OPT_IN: OPT_IN,
};
