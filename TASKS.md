# TASKS.md — TextCatch Build Tracker
 
> Living checklist. Update after every work session: check off what's done,
> mark what's in progress, add anything discovered. Pair with CLAUDE.md (the plan).
> Session start: "Read CLAUDE.md and TASKS.md, then continue the next unchecked task."
 
Status key:  [ ] todo   [~] in progress   [x] done   [!] blocked
 
Last updated: 2026-06-27 (A2P campaign rejected → fixed + resubmitted, back IN REVIEW; Twilio active)
 
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
- [!] A2P 10DLC campaign — first submission REJECTED (invalid campaign description +
      invalid sample message content). FIXED: rewrote the description to explain the
      website opt-in flow and reference the Privacy/Terms pages; replaced sample messages
      with realistic ones (real example name, STOP/HELP, rate disclosure). RESUBMITTED
      June 27 — back IN REVIEW. Until approved, carriers may filter/block sends.
      Widget intentionally still DISABLED on the live site (script commented out in index.html).
      THIS IS THE NEXT ACTION — see bottom.
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
➡  WAIT on A2P 10DLC campaign approval (submitted June 27, IN REVIEW). Twilio number,
   credentials, compliance profile, and the 4 Vercel env vars are all DONE; backend is
   deployed (origin/main @ 3b81ad9). Widget is still disabled on the live site.
   When the A2P campaign is APPROVED:
     1. Re-enable the widget: uncomment <script src="/textcatch-widget.js" defer> in index.html
     2. vercel --prod
     3. Submit a test lead through the live widget
     4. Confirm BOTH texts arrive (visitor confirmation + owner alert)
