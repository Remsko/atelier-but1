// Atelier BUT 1 — fonction « edt »
// Va chercher l'emploi du temps Celcat de la personne connectée (le lien qu'elle a collé dans le site)
// et le renvoie au navigateur. Celcat bloque la lecture directe depuis un site web, d'où ce relais.
// Aucun mot de passe : seulement le lien d'abonnement .ics de chacun.

const URL_ = Deno.env.get('SUPABASE_URL')!;
// clés : anciennes (anon / service_role) ou nouvelles (publishable / secret), selon le projet
const pickKey = (legacy: string, dict: string) => {
  const v = Deno.env.get(legacy); if (v) return v;
  try { const d = JSON.parse(Deno.env.get(dict) || '{}'); return d.default || Object.values(d)[0] as string || ''; } catch { return ''; }
};
const ANON = pickKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
// sites autorisés (évite que le relais serve à lire n'importe quelle page)
const ALLOWED = (Deno.env.get('EDT_ALLOWED_HOSTS') || 'extra.u-picardie.fr').split(',').map(s => s.trim()).filter(Boolean);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function checkUrl(raw: string): URL | null {
  try {
    const u = new URL(String(raw || '').trim().replace(/^webcal:/i, 'https:'));
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    if (!ALLOWED.includes(u.hostname)) return null;
    return u;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization') || '';
  // qui appelle ?
  const who = await fetch(URL_ + '/auth/v1/user', { headers: { Authorization: auth, apikey: ANON } });
  if (!who.ok) return json({ error: 'non connecté' }, 401);
  const user = await who.json();

  let raw: string | null = null;
  if (req.method === 'POST') {
    // « Tester ce lien » avant de l'enregistrer
    try { raw = (await req.json()).url || null; } catch { raw = null; }
  }
  if (!raw) {
    const p = await fetch(URL_ + '/rest/v1/profiles?select=celcat_url&id=eq.' + encodeURIComponent(user.id), { headers: { Authorization: auth, apikey: ANON } });
    const rows = p.ok ? await p.json() : [];
    raw = rows[0]?.celcat_url || null;
  }
  if (!raw) return json({ error: 'aucun lien d\'emploi du temps enregistré' }, 404);
  const u = checkUrl(raw);
  if (!u) return json({ error: 'ce lien n\'est pas un lien Celcat de l\'université (' + ALLOWED.join(', ') + ')' }, 400);

  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(u.toString(), { signal: ctl.signal, headers: { 'User-Agent': 'AtelierBUT1/1.0 (+calendar)' } });
    clearTimeout(t);
    if (!r.ok) return json({ error: 'Celcat a répondu ' + r.status }, 502);
    const text = await r.text();
    if (!/BEGIN:VCALENDAR/.test(text)) return json({ error: 'ce lien ne renvoie pas un calendrier (.ics)' }, 502);
    return new Response(text, { headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (e) {
    return json({ error: 'Celcat ne répond pas' }, 504);
  }
});
