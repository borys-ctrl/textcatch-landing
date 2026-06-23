# TextCatch — Landing Page (Smoke Test)

A single-page landing site used to validate demand for **TextCatch**: a chat-to-text
lead-capture widget for local service businesses. Visitors see a live demo of the
widget and are invited to "Start free trial." Trial sign-ups are the validation signal.

## Files
- `index.html` — the entire site (HTML + CSS + JS, no build step, no dependencies).

## Deploy
This is a static site. Any static host works.

**Vercel (recommended):**
1. Push this repo to GitHub.
2. vercel.com → Add New → Project → import `textcatch-landing`.
3. Framework preset: **Other**. No build command. Output dir: `/` (root).
4. Deploy.

## The test
- Drive ~40 small-business owners to the page (cold email / DM).
- Track two numbers: clicks on **Start free trial** and completed **form submits**.
- Read: 5+ submits / 40 = real demand; 1–2 = weak; 0 = killed.

## TODO before launch
- [ ] Wire the trial form to email you (Formspree or a Vercel serverless function).
      Right now `submitForm()` in `index.html` only shows a thank-you state — it does
      not yet send the lead anywhere.
- [ ] Point a domain at the deploy (e.g. textcatch.io).
