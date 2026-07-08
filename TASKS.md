# TASKS.md — TextCatch Build Tracker
 
> Living checklist. Update after every work session: check off what's done,
> mark what's in progress, add anything discovered. Pair with CLAUDE.md (the plan).
> Session start: "Read CLAUDE.md and TASKS.md, then continue the next unchecked task."
 
Status key:  [ ] todo   [~] in progress   [x] done   [!] blocked
 
Last updated: 2026-07-07 (A2P rejected on CTA/opt-in verification — widget was disabled so Twilio couldn't find the opt-in; re-enabled widget + strengthened consent line, redeploying)
 
---
 
## DONE (before this build)
- [x] Landing page live (index.html) on textcatch.app / textcatch-landing.vercel.app
- [x] Email lead path working (/api/lead.js → Resend → borys@bestflooringhonolulu.com)
- [x] widget-source.js saved (byte-faithful copy of the Kai Shopify widget, 394 lines)
- [x] CLAUDE.md committed (project plan + context)
---
 
## LAYER 1 — Widget (the TextCatch-branded chat bubble)  ✅ built + pushed (post leg waits on Layer 2)
- [x] Fork widget-source.js → textcatch-widget.js (Shopify wrapper stripped; IDs kept as bfh-* by choice)
- [x] Update CONFIG: agentName "Tex", businessName "TextCatch", accent #16B57A, text logo, peek/ask/closing copy
- [x] Point CONFIG.webhookUrl at the new TextCatch backend (set to /api/chat, same-origin)
- [x] Embed the widget on the landing page (index.html, <script src="/textcatch-widget.js" defer>)
- [~] Verify it opens, captures name/phone/email/comment, and posts cleanly
      (UI/capture ready; the POST will 404/throw until webhookUrl points at a live backend — Layer 2)
## LAYER 2 — Backend + Twilio (the two outbound texts)  🟡 deployed + creds set; A2P campaign IN REVIEW
- [x] Backend endpoint receives the lead POST from the widget (/api/chat.js, CommonJS, raw fetch — no SDK)
- [x] Send SMS #1 to the VISITOR (confirmation copy — see CLAUDE.md)
      Updated with A2P compliance tail: "...Msg & data rates may apply. Reply STOP to opt out, HELP for help."
- [x] Send SMS #2 to BORYS'S CELL (lead alert copy — see CLAUDE.md)
      Reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER / OWNER_PHONE_NUMBER from env.
      Promise.allSettled: a bad visitor # won't block the owner alert; 502 only if both fail.
- [x] Twilio account + phone number + credentials — Twilio number PURCHASED; compliance profile APPROVED.
- [x] Store Twilio creds + owner cell as Vercel env vars (4 vars set; never in code/chat)
- [x] Deploy backend to prod (/api/chat live — GET returns 405 as expected; origin/main @ 3b81ad9)
- [!] A2P 10DLC campaign — REJECTED TWICE (latest: Error 30886, campaign description
      did not match the registered brand + use case).
      Root cause: brand registered as Muoma LLC (dba TextCatch); use case set to Marketing.
      Fixes applied:
        * Rewrote campaign description to name Muoma LLC as the operator of TextCatch
          and explain the website opt-in flow (references Privacy/Terms pages).
        * Added "© 2026 Muoma LLC dba TextCatch" to all three footers (deployed, 8583f54)
          so the public site matches the registered brand.
        * Use case is LOCKED as Marketing — can't edit without recreating the campaign
          (and paying a new fee). Left as-is for this resubmission.
      RESUBMITTED July 1 — IN REVIEW. Until approved, carriers may filter/block sends.
      FALLBACK: if rejected again SOLELY on use case, recreate the campaign as Customer Care.
- [~] A2P CTA / opt-in verification — REJECTED because the widget (the opt-in CTA) was
      DISABLED on the live site, so Twilio's reviewer couldn't find the consent flow.
      Fix (2026-07-07): re-enabled <script src="/textcatch-widget.js"> in index.html and
      strengthened the in-widget consent line to the full CTA disclosure set — business name,
      "Message frequency varies", "Msg & data rates may apply", "Reply STOP to opt out, HELP
      for help", plus links to /privacy and /terms. Redeploy, then resubmit for A2P review.
- [ ] Test end-to-end: submit widget → both texts arrive (gated on A2P approval)
      Twilio account ACTIVE, balance ~$19.35 (first ~$20 spent on non-refundable
      A2P registration/vetting fees).
## LAYER 3 — Database (store leads + messages)
- [ ] Choose store (Vercel Postgres or similar)
- [ ] Schema: leads (name, phone, email, comment, created_at) + messages (lead_id, direction, body, ts)
- [ ] Backend writes every new lead + the outbound texts to the DB
## LAYER 4 — Inbound SMS (capture replies)
- [ ] Twilio inbound webhook → backend endpoint
- [ ] Match incoming text to the lead by phone number, save to messages
- [ ] Test: reply to a confirmation text → it lands in the DB
## LAYER 5 — Panel (the lead inbox UI)
- [ ] Page that lists all leads (newest first)
- [ ] Open a lead → see full conversation thread
- [ ] Reply box → sends via Twilio + saves to DB
- [ ] (Nice-to-have) "copy of every lead alert forwarded to personal cell" — already covered by SMS #2
## LAYER 6 — Auth (lock the panel to Borys)
- [ ] Login protection on the panel (only Borys sees leads)
- [ ] Confirm panel is not publicly accessible
---
 
## LEGAL & COMPLIANCE (needed for A2P / carrier approval)  ✅ live
- [x] Privacy policy page — privacy.html, live at /privacy (SMS consent, STOP/HELP, no-sharing clause)
- [x] Terms & Conditions page — terms.html, live at /terms
- [x] Footer links to /privacy and /terms on the landing page (cleanUrls enabled via vercel.json)
- [x] Public contact email set to textcatchapp@gmail.com across index.html, privacy.html, terms.html
      (NOTE: separate from backend recipients — /api/lead.js still emails borys@bestflooringhonolulu.com,
       and SMS #2 goes to OWNER_PHONE_NUMBER. Repoint those later if desired.)
---
 
## CLEANUP / LOOSE ENDS
- [ ] Attach textcatch.app domain to the Vercel project (Settings → Domains)
- [ ] Rotate the Resend API key (was pasted in chat → treat as exposed)
- [ ] Decide: link GitHub repo to Vercel for auto-deploy on push?
---
 
## NEXT ACTION
➡  DEPLOY the CTA fix, then RESUBMIT A2P. The widget is now re-enabled + the consent line
   strengthened (index.html + textcatch-widget.js changed locally).
     1. Commit + push to origin/main (Vercel auto-deploys the live site).
     2. Verify on https://textcatch.app: chat bubble appears → open it → lead form shows the
        full consent line with STOP/HELP + Privacy/Terms links.
     3. Resubmit the A2P 10DLC campaign for review, pointing the CTA/opt-in to textcatch.app.
   NOTE: the widget POST will still hit /api/chat (Twilio). If A2P isn't approved yet, sends
   may be filtered — but the opt-in CTA must be LIVE for the reviewer regardless.
   After A2P approval: submit a test lead → confirm BOTH texts arrive (visitor + owner alert).
