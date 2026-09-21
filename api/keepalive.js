// Vercel cron target: touches Supabase once a day so the free-tier project
// never hits the 7-days-without-a-request pause. Schedule lives in vercel.json.
// Vercel calls this with "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET
// is set in the project env; if it's not set, any GET is accepted.

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== "Bearer " + secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) return res.status(500).json({ ok: false, error: "Supabase env not set" });

  try {
    const r = await fetch(base.replace(/\/+$/, "") + "/rest/v1/conversations?select=id&limit=1", {
      headers: { apikey: key, Authorization: "Bearer " + key },
    });
    const body = await r.text();
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, at: new Date().toISOString(), body: body.slice(0, 200) });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String(e) });
  }
};
