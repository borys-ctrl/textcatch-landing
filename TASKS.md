# TASKS.md — TextCatch Build Tracker
 
> Living checklist. Update after every work session: check off what's done,
> mark what's in progress, add anything discovered. Pair with CLAUDE.md (the plan).
> Session start: "Read CLAUDE.md and TASKS.md, then continue the next unchecked task."
 
Status key:  [ ] todo   [~] in progress   [x] done   [!] blocked
 
Last updated: 2026-06-25
 
---
 
## DONE (before this build)
- [x] Landing page live (index.html) on textcatch.app / textcatch-landing.vercel.app
- [x] Email lead path working (/api/lead.js → Resend → borys@bestflooringhonolulu.com)
- [x] widget-source.js saved (byte-faithful copy of the Kai Shopify widget, 394 lines)
- [x] CLAUDE.md committed (project plan + context)
---
 
## LAYER 1 — Widget (the TextCatch-branded chat bubble)  ✅ built (post leg waits on Layer 2)
- [x] Fork widget-source.js → textcatch-widget.js (Shopify wrapper stripped; IDs kept as bfh-* by choice)
- [x] Update CONFIG: agentName "Tex", businessName "TextCatch", accent #16B57A, text logo, peek/ask/closing copy
- [x] Point CONFIG.webhookUrl at the new TextCatch backend (set to /api/chat, same-origin)
- [x] Embed the widget on the landing page (index.html, <script src="/textcatch-widget.js" defer>)
- [~] Verify it opens, captures name/phone/email/comment, and posts cleanly
      (UI/capture ready; the POST will 404/throw until webhookUrl points at a live backend — Layer 2)
## LAYER 2 — Backend + Twilio (the two outbound texts)  🟡 code drafted, NOT deployed
- [x] Backend endpoint receives the lead POST from the widget (/api/chat.js, CommonJS, raw fetch — no SDK)
- [x] Send SMS #1 to the VISITOR (confirmation copy — see CLAUDE.md)
- [x] Send SMS #2 to BORYS'S CELL (lead alert copy — see CLAUDE.md)
      Reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER / OWNER_PHONE_NUMBER from env.
      Promise.allSettled: a bad visitor # won't block the owner alert; 502 only if both fail.
- [!] Twilio account + phone number + credentials (Account SID, Auth Token, Twilio #)
      BLOCKED: awaiting Borys's Twilio status. THIS IS THE NEXT ACTION.
- [ ] Store Twilio creds + Borys's personal cell as Vercel env vars (never in code/chat)
- [ ] Deploy (held until creds exist, so the live demo isn't a dead submit button)
- [ ] Test end-to-end: submit widget → both texts arrive
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
 
## CLEANUP / LOOSE ENDS
- [ ] Attach textcatch.app domain to the Vercel project (Settings → Domains)
- [ ] Rotate the Resend API key (was pasted in chat → treat as exposed)
- [ ] Decide: link GitHub repo to Vercel for auto-deploy on push?
---
 
## NEXT ACTION
➡  Resolve Twilio setup (Layer 2, first blocked item). Borys to confirm:
   account yet? phone number yet? Then we wire credentials and build Layer 1+2.
