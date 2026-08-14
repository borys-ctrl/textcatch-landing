# TextCatch

A chat-to-text lead capture widget for local service businesses. A visitor asks a
question in the widget, leaves their number, and the business owner gets the lead
as a text. If the visitor opts in to SMS, they get a confirmation text too.

Operated by Muoma LLC. Live at https://www.textcatch.app

## Files

- `index.html` — the landing page (HTML + CSS + JS, no build step)
- `textcatch-widget.js` — the chat widget itself; `CONFIG` at the top is per-install
- `api/chat.js` — receives a lead, sends the SMS, saves the lead
- `api/sites.js` — tenant registry: which siteId maps to which business and phone
- `api/store.js` — writes leads to Supabase; no-ops safely if unconfigured
- `api/lead.js` — the "Start free trial" form, emails via Resend

No `package.json`. Everything uses plain `fetch` against REST APIs — keep it that way.

## Environment variables

Set these in the Vercel project. **Changing them requires a redeploy** — Vercel does
not pick up new values on its own.

| Variable | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio auth |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_PHONE_NUMBER` | The 10DLC number messages are sent from |
| `OWNER_PHONE_NUMBER` | Fallback lead-alert number if a site has none |
| `OWNER_PHONE_<SITE>` | Per-site lead-alert number, e.g. `OWNER_PHONE_BFH` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase **secret** key (server-side only) |
| `RESEND_API_KEY` | Trial-form email delivery |

Leads are stored in a `leads` table with row level security on and no policies, so
only the secret key can read or write it. Never expose that key to the browser.

## Adding a customer

1. Add a row to `SITES` in `api/sites.js`:

```js
coastal-plumbing: {
  businessName: "Coastal Plumbing Co.",
  ownerPhoneEnv: "OWNER_PHONE_COASTAL_PLUMBING",
},
```

2. Set that env var in Vercel to their phone number, then redeploy.
3. Give them the widget snippet with `siteId: "coastal-plumbing"` in `CONFIG`.

Their leads go to their phone. An unknown siteId is rejected with a 400 rather than
being routed anywhere.

## Compliance

A2P 10DLC campaign `CMe61c31dfc62366dd0ae27baf1027d6b6` (approved). The SMS consent
checkbox must stay **optional and unchecked by default** — making it required is
"forced consent" and gets the campaign rejected. Visitor confirmation texts must keep
the STOP/HELP language and stay within one 160-character segment.

## Deploy

Vercel, auto-deploys on push to `main`. No build command; output dir is root.
