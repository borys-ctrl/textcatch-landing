# CLAUDE.md — TextCatch

> Auto-loaded by Claude Code each session. This is the source of truth for the
> TextCatch build. Update it whenever scope or state changes.

## What TextCatch is
A chat-to-text lead-capture widget for local service businesses. A visitor taps
a chat bubble on a business website, asks a question, leaves their phone number,
and the conversation continues over SMS. Owner: Borys
(borys@bestflooringhonolulu.com).

Originally a smoke-test (a landing page to validate demand). **Now scoped up to
the real product** — Borys wants to use it himself and demo the working backend
on the landing page.

## Live assets
- Landing page: https://textcatch.app  (repo: github.com/borys-ctrl/textcatch-landing, Vercel project textcatch-landing, team borys-projects3)
- Landing page already has: index.html + /api/lead.js (Resend email on form submit). Working.
- Widget base source: `widget-source.js` in this repo — a byte-faithful copy of the
  "Kai" chat widget from the Best Flooring Honolulu Shopify theme (theme.liquid).
  394 lines, self-contained vanilla JS (CONFIG → CSS → launcher/peek/panel/form).
  The original posts to bfh-lead-relay (Zoho + email). We are FORKING it.

## The build — 6 layers (build in order, each working before the next)
1. **Widget** — fork widget-source.js → TextCatch-branded, embeddable. Change
   CONFIG: webhookUrl, agentName, businessName, logoUrl, accent colors, copy.
2. **Backend** — receives the lead POST, sends TWO Twilio SMS (see copy below).
3. **Database** — stores leads + message history (for the panel). Likely Vercel Postgres.
4. **Inbound SMS** — Twilio webhook catches replies from leads, saves to the conversation.
5. **Panel** — login-protected page: list leads, view each conversation, reply (sends via Twilio).
6. **Auth** — so only Borys sees the leads.

Layers 1–2 = the demo. Layers 3–6 = the actual product (a working lead inbox).

## Exact SMS copy (confirmed by Borys)
**To the visitor** (sent to the phone number they entered):
> Good day, [name]. Thank you for contacting textcatch.app. We received your
> question: [comment]. [optional extra details]. You'll hear from us soon.

**To Borys** (the lead alert — send DIRECTLY to Borys's personal cell, no Twilio-number
forwarding step):
> New lead:
> [name]
> [phone number]
> [email]
> [comment]

## Architecture
widget (on textcatch.app) → backend /api/… → Twilio (2 texts) + save lead to DB
lead replies via SMS → Twilio inbound webhook → save to DB → visible in panel
panel → Borys reads/replies → Twilio sends reply to lead

## Current state / next step
- **LAYER 1 not started yet.** Blocked on Twilio setup (Layer 2 needs it, so
  setting it up first).
- **NEXT: Twilio account + phone number + credentials** (Account SID, Auth Token,
  Twilio phone number). Borys was about to answer whether he has a Twilio account.
- Credentials must go into Vercel env vars (never committed, never pasted in chat).

## Hard-won deployment notes (don't relearn these)
- The web chat surface (claude.ai) has READ-ONLY GitHub/Vercel tools — it CANNOT
  push or deploy. All git/deploy/env-var work happens HERE in Claude Code.
- Resend key for the email path is already a Vercel env var (RESEND_API_KEY).
  It was pasted in chat earlier → should be rotated.
- Don't modify the live Shopify theme. widget-source.js was copied read-only.

## Repos (borys-ctrl)
- textcatch-landing (public) — this project
- bfh-flooring-calculator (public) — BFH cost calculator
- bfh-lead-relay (private) — Kai widget backend → Zoho + Resend fallback
- bfh-lead-proxy (private), leadminer (private), contractflag (public)
