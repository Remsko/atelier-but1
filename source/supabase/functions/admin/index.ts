// Atelier BUT 1 — fonction « admin »
// Gestion des comptes (créer, lister, changer un mot de passe, supprimer), réservée aux comptes admin.
// La clé « service_role » reste ici, côté serveur : elle n'est jamais envoyée au navigateur.

const URL_ = Deno.env.get('SUPABASE_URL')!;
// clés : anciennes (anon / service_role) ou nouvelles (publishable / secret), selon le projet
const pickKey = (legacy: string, dict: string) => {
  const v = Deno.env.get(legacy); if (v) return v;
  try { const d = JSON.parse(Deno.env.get(dict) || '{}'); return d.default || Object.values(d)[0] as string || ''; } catch { return ''; }
};
const ANON = pickKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const SERVICE = pickKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
const DOMAIN = Deno.env.get('LOGIN_DOMAIN') || 'atelier-but1.invalid';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const svc = (path: string, init: RequestInit = {}) => fetch(URL_ + path, {
  ...init, headers: { apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json', ...(init.headers || {}) },
});
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,40}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization') || '';
  const who = await fetch(URL_ + '/auth/v1/user', { headers: { Authorization: auth, apikey: ANON } });
  if (!who.ok) return json({ error: 'non connecté' }, 401);
  const me = await who.json();
  const pr = await svc('/rest/v1/profiles?select=is_admin&id=eq.' + me.id);
  const rows = pr.ok ? await pr.json() : [];
  if (!rows[0]?.is_admin) return json({ error: 'réservé à l\'administrateur' }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* vide */ }
  const action = body.action;

  if (action === 'list') {
    const r = await svc('/auth/v1/admin/users?per_page=1000');
    const j = await r.json();
    const profs = await (await svc('/rest/v1/profiles?select=id,login,display_name,is_admin,celcat_url')).json();
    const pm = new Map((profs as any[]).map(p => [p.id, p]));
    const users = (j.users || []).map((u: any) => {
      const p: any = pm.get(u.id) || {};
      return { id: u.id, email: u.email, login: p.login || u.user_metadata?.login || u.email, name: p.display_name || '', admin: !!p.is_admin,
        edt: !!p.celcat_url, created: u.created_at, lastSeen: u.last_sign_in_at || null };
    });
    users.sort((a: any, b: any) => String(a.login).localeCompare(String(b.login)));
    return json({ users, domain: DOMAIN });
  }

  if (action === 'create') {
    const login = String(body.login || '').trim().toLowerCase();
    const given = String(body.email || '').trim().toLowerCase();
    const email = login.includes('@') ? login : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(given) ? given : login + '@' + DOMAIN;
    if (!login.includes('@') && !LOGIN_RE.test(login)) return json({ error: 'identifiant invalide (lettres, chiffres, point, tiret)' }, 400);
    if (String(body.password || '').length < 8) return json({ error: 'mot de passe trop court (8 caractères minimum)' }, 400);
    const shortLogin = login.includes('@') ? login.split('@')[0] : login;
    const r = await svc('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({
      email, password: body.password, email_confirm: true,
      user_metadata: { login: shortLogin, display_name: String(body.name || shortLogin).slice(0, 80) },
    }) });
    const j = await r.json();
    if (!r.ok) {
      const t = JSON.stringify(j);
      const msg = /already|exists|registered/i.test(t) ? 'cet identifiant existe déjà'
        : /email_address_invalid|invalid.*email|email.*invalid/i.test(t) ? 'Supabase refuse l\'adresse ' + email + ' : change « loginPattern » dans config.js (voir le guide d\'installation)'
        : (j.msg || j.message || 'création impossible');
      return json({ error: msg }, 400);
    }
    return json({ ok: true, id: j.id, login: shortLogin });
  }

  if (action === 'password') {
    if (String(body.password || '').length < 8) return json({ error: 'mot de passe trop court (8 caractères minimum)' }, 400);
    const r = await svc('/auth/v1/admin/users/' + encodeURIComponent(body.id), { method: 'PUT', body: JSON.stringify({ password: body.password }) });
    return r.ok ? json({ ok: true }) : json({ error: 'changement impossible' }, 400);
  }

  if (action === 'delete') {
    if (body.id === me.id) return json({ error: 'tu ne peux pas supprimer ton propre compte' }, 400);
    const r = await svc('/auth/v1/admin/users/' + encodeURIComponent(body.id), { method: 'DELETE' });
    return r.ok ? json({ ok: true }) : json({ error: 'suppression impossible' }, 400);
  }

  return json({ error: 'action inconnue' }, 400);
});
