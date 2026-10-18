// Atelier BUT 1 — fonction « drive-sync »
// Copie automatiquement le dossier « BUT 1 » de Google Drive dans la bibliothèque de cours commune.
// - Lecture du Drive par un compte robot Google (secret GDRIVE_SA_JSON = la clé JSON du compte de service).
//   Le dossier reste privé : Rémi le partage seulement avec l'adresse du robot (lecture).
// - Seuls les fichiers nouveaux ou modifiés sont copiés ; ce qui disparaît du Drive disparaît du site.
// - Même tri que l'import manuel : sujets et cours pour tout le monde ; réponses, code, corrections… seulement dans l'espace de Rémi.
// - Appelée chaque heure par pg_cron (en-tête x-sync-key) ou par le bouton « Synchroniser maintenant » (admin).

const URL_ = Deno.env.get('SUPABASE_URL')!;
const pickKey = (legacy: string, dict: string) => {
  const v = Deno.env.get(legacy); if (v) return v;
  try { const d = JSON.parse(Deno.env.get(dict) || '{}'); return d.default || Object.values(d)[0] as string || ''; } catch { return ''; }
};
const ANON = pickKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const SERVICE = pickKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const svcHeaders = () => ({ apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }) });
const svc = (path: string, init: RequestInit = {}) => fetch(URL_ + path, {
  ...init, headers: { ...svcHeaders(), 'Content-Type': 'application/json', ...(init.headers || {}) },
});
async function svcJson(path: string, init: RequestInit = {}) {
  const r = await svc(path, init); const t = await r.text();
  if (!r.ok) throw new Error('base : ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

// ---------- mêmes règles que web/shim.js ----------
const FOLDER = 'application/vnd.google-apps.folder';
const ROOT_ID = 'but1';
const TEXT_EXT = /\.(c|cc|cpp|cxx|h|hpp|hh|txt|md|sql|csv|tsv|json|html?|css|js|mjs|py|java|sh|xml|svg|ics|ini|cfg|log)$/i;
const PRIVATE_NAME = /corrig|correction|r[ée]ponse|solution|rendu|brouillon|perso/i;
const SHARE_OK = /\.(pdf|docx?|pptx?|xlsx?|odt|odp|ods|rtf|png|jpe?g|gif|webp|svg|sql|csv|tsv)$/i;
const SITE_DOC_RE = /atelier but ?1|emploi du temps/i;
const MIMES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', md: 'text/markdown',
  csv: 'text/csv', tsv: 'text/tab-separated-values', sql: 'text/plain', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', odp: 'application/vnd.oasis.opendocument.presentation', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};
const mimeOf = (name: string) => MIMES[((/\.([^.]+)$/.exec(name) || [, ''])[1] as string).toLowerCase()] || (TEXT_EXT.test(name) ? 'text/plain' : 'application/octet-stream');
// le contenu des tables d'un TD de SQL (copié depuis C5) est une donnée du cours : tout le monde en a besoin pour exécuter ses requêtes
const TABLES_RE = /contenu des tables/i;
const isPrivate = (name: string, parts: string[]) => TABLES_RE.test(name) && !parts.slice(0, -1).some(p => PRIVATE_NAME.test(p)) ? false : !SHARE_OK.test(name) || SITE_DOC_RE.test(name) || PRIVATE_NAME.test(name) || parts.some(p => PRIVATE_NAME.test(p));
// les fichiers Google (Docs, Slides, Sheets, Dessins) sont convertis
const EXPORT: Record<string, [string, string]> = {
  'application/vnd.google-apps.document': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.spreadsheet': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.drawing': ['image/png', '.png'],
};
const MAX_BYTES = 45 * 1024 * 1024;
const enc = new TextEncoder(), dec = new TextDecoder();
async function sha(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(s))), b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }

// ---------- compte robot Google ----------
function robot() {
  const raw = Deno.env.get('GDRIVE_SA_JSON') || '';
  if (!raw.trim()) return null;
  try { const j = JSON.parse(raw); if (j.client_email && j.private_key) return j as { client_email: string; private_key: string }; } catch { /* */ }
  return { client_email: '', private_key: '', bad: true } as any;
}
const b64url = (b: Uint8Array | string) => btoa(typeof b === 'string' ? unescape(encodeURIComponent(b)) : String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function googleToken(sa: { client_email: string; private_key: string }) {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + b64url(sig) });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('Google refuse la clé du robot (' + (j.error_description || j.error || r.status) + ')');
  return j.access_token as string;
}
const G = 'https://www.googleapis.com/drive/v3/files';
async function gfetch(tok: string, url: string) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 404) throw new Error('dossier introuvable : vérifie qu\'il est bien partagé avec le robot');
    throw new Error('Google Drive : ' + r.status + ' ' + t.slice(0, 160));
  }
  return r;
}
type GFile = { id: string; name: string; mimeType: string; modifiedTime: string; size?: string; shortcutDetails?: { targetId: string; targetMimeType: string } };
async function listChildren(tok: string, folder: string): Promise<GFile[]> {
  const out: GFile[] = []; let page = '';
  do {
    const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
    const r = await gfetch(tok, `${G}?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,shortcutDetails)` + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    const j = await r.json(); out.push(...(j.files || [])); page = j.nextPageToken || '';
  } while (page);
  return out;
}
async function getMeta(tok: string, id: string): Promise<GFile> {
  return (await gfetch(tok, `${G}/${id}?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,size`)).json();
}

// ---------- état (table privée sync_state, une seule ligne id = 1) ----------
async function state() { return (await svcJson('/rest/v1/sync_state?id=eq.1&select=*'))[0] || null; }
async function saveState(patch: Record<string, unknown>) {
  await svcJson('/rest/v1/sync_state?id=eq.1', { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
}

// ---------- la synchro ----------
// Deux circuits :
//  - cours (sujets, PDF, images, tables SQL) → bibliothèque commune (owner vide), visibles par tous ;
//  - le reste (réponses, code, corrections, brouillons…) → seulement l'espace perso de Rémi (sync_state.private_owner).
const JUNK = /\.(exe|msi|dmg|iso|zip|7z|rar|tar|gz|mp4|mov|avi|mkv|webm|mp3|wav|vmdk|ova)$/i;
const CONFIG_FILE = /^(emploi du temps\.json|mescoursjv - suivi\.json)$/i;
const MAX_PRIVATE = 20 * 1024 * 1024;
async function storageDelete(path: string) {
  const [bucket, ...p] = path.split('/');
  await fetch(URL_ + '/storage/v1/object/' + bucket, { method: 'DELETE', headers: { ...svcHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [p.join('/')] }) });
}
type Item = { k: GFile; segs: string[]; name: string; exp?: [string, string]; priv: boolean };

async function run(budgetMs: number) {
  const t0 = Date.now();
  const st = await state();
  if (!st?.folder_id) throw new Error('aucun dossier Drive choisi');
  const sa = robot();
  if (!sa) throw new Error('le robot n\'est pas encore configuré (secret GDRIVE_SA_JSON)');
  if ((sa as any).bad) throw new Error('le secret GDRIVE_SA_JSON n\'est pas une clé JSON valide');
  const tok = await googleToken(sa);
  const root = await getMeta(tok, st.folder_id);
  if (root.mimeType !== FOLDER) throw new Error('le lien choisi n\'est pas un dossier');
  const me: string | null = st.private_owner || null;

  const stats = { added: 0, updated: 0, unchanged: 0, skipped: 0, removed: 0, mine: 0, errors: [] as string[] };
  let partial = false;

  // 1) parcours du Drive
  const items: Item[] = []; const driveDirs = new Map<string, GFile>(); // chemin → dossier Drive
  const visited = new Set<string>([root.id]);
  const queue: [string, string[]][] = [[root.id, []]];
  while (queue.length) {
    const [gid, path] = queue.shift()!;
    let kids: GFile[];
    try { kids = await listChildren(tok, gid); } catch (e) { stats.errors.push((path.join('/') || 'racine') + ' : ' + (e as Error).message); partial = true; continue; }
    const names = new Set<string>();
    for (let k of kids) {
      if (k.mimeType === 'application/vnd.google-apps.shortcut' && k.shortcutDetails) {
        try { const t = await getMeta(tok, k.shortcutDetails.targetId); k = { ...t, name: k.name }; } catch { stats.skipped++; continue; }
      }
      if (/^(\.|__MACOSX|Thumbs\.db|desktop\.ini)/i.test(k.name)) continue;
      if (k.mimeType === FOLDER) {
        if (visited.has(k.id)) continue; visited.add(k.id);
        const segs = [...path, k.name]; driveDirs.set(segs.join('/'), k); queue.push([k.id, segs]); continue;
      }
      const exp = EXPORT[k.mimeType];
      if (!exp && k.mimeType.startsWith('application/vnd.google-apps.')) { stats.skipped++; continue; } // formulaires, sites…
      const name = exp && !k.name.toLowerCase().endsWith(exp[1]) ? k.name + exp[1] : k.name;
      if (CONFIG_FILE.test(name) || SITE_DOC_RE.test(name) || JUNK.test(name)) { stats.skipped++; continue; }
      if (names.has(name)) { stats.skipped++; continue; } names.add(name); // même nom deux fois dans un dossier
      const priv = isPrivate(name, [...path, name]);
      if (priv && !me) { stats.skipped++; continue; }
      items.push({ k, segs: path, name, exp, priv });
    }
  }

  // 2) ce que le site a déjà (cours partagés + fichiers de Rémi)
  const rows = new Map<string, any>();
  const load = async (filter: string) => {
    for (let from = 0; ; from += 1000) {
      const part = await svcJson(`/rest/v1/files?${filter}&select=id,owner,parent,name,size,mime,storage_path,modified&order=id&offset=${from}&limit=1000`);
      for (const r of part) rows.set(r.id, r); if (part.length < 1000) break;
    }
  };
  await load('owner=is.null'); if (me) await load('owner=eq.' + me);
  const byPlace = new Map<string, any>(); // « parent|nom » → ligne (pour retrouver ce qui existe déjà)
  for (const r of rows.values()) { const key = r.parent + '|' + r.name; const cur = byPlace.get(key); if (!cur || (cur.owner && !r.owner)) byPlace.set(key, r); }
  const map = new Map<string, any>((await svcJson('/rest/v1/drive_map?select=*')).map((m: any) => [m.file_id, m]));
  const seen = new Set<string>();
  const putMap = (row: any) => svcJson('/rest/v1/drive_map', { method: 'POST', body: JSON.stringify([row]), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  const upsertFile = (row: any) => svcJson('/rest/v1/files', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  const remember = (r: any) => { rows.set(r.id, r); byPlace.set(r.parent + '|' + r.name, r); };

  // 3) dossiers créés seulement quand il faut : un dossier qui ne contient que du privé reste dans l'espace de Rémi
  const dirId = new Map<string, string>([['', ROOT_ID]]);
  const ensureFolder = async (segs: string[], shared: boolean): Promise<string> => {
    const key = segs.join('/');
    if (!segs.length) return ROOT_ID;
    const parent = await ensureFolder(segs.slice(0, -1), shared);
    let id = dirId.get(key); let row = id ? rows.get(id) : null;
    if (!row) {
      const cid = 'c' + await sha('dir:' + key);
      row = rows.get(cid) || byPlace.get(parent + '|' + segs[segs.length - 1]);
      if (row && row.mime !== FOLDER) row = null;
      const g = driveDirs.get(key);
      if (!row) {
        row = { id: shared ? cid : 'p' + await sha('dir:' + key), owner: shared ? null : me, parent, name: segs[segs.length - 1], mime: FOLDER, modified: g?.modifiedTime || new Date().toISOString() };
        await upsertFile(row); remember(row);
      }
      if (g && !map.has(row.id)) { const m = { file_id: row.id, drive_id: g.id, drive_modified: g.modifiedTime, kind: 'folder', owner: row.owner }; await putMap(m); map.set(row.id, m); }
      dirId.set(key, row.id);
    }
    if (shared && row.owner) { // un cours arrive dans un dossier jusque-là privé : le dossier devient commun
      await svcJson('/rest/v1/files?id=eq.' + encodeURIComponent(row.id), { method: 'PATCH', body: JSON.stringify({ owner: null }), headers: { Prefer: 'return=minimal' } });
      row.owner = null; const m = map.get(row.id); if (m) { m.owner = null; await putMap(m); }
    }
    seen.add(row.id);
    return row.id;
  };
  // les dossiers du Drive déjà connus restent marqués « vus » même vides
  for (const [key] of driveDirs) { const id = dirId.get(key) || 'c' + await sha('dir:' + key); if (rows.has(id)) seen.add(id); }
  for (const m of map.values()) if (m.kind === 'folder' && [...driveDirs.values()].some(g => g.id === m.drive_id)) seen.add(m.file_id);

  // 4) les fichiers
  for (const it of items) {
    const { k, exp, priv } = it;
    const parent = await ensureFolder(it.segs, !priv);
    const pathKey = [...it.segs, it.name].join('/');
    let have = priv ? null : rows.get('c' + await sha('file:' + pathKey));
    if (priv) { const p = byPlace.get(parent + '|' + it.name); have = p && p.owner === me ? p : rows.get('p' + await sha('file:' + pathKey)) || null; }
    const id = have ? have.id : (priv ? 'p' : 'c') + await sha('file:' + pathKey);
    seen.add(id);
    const m = map.get(id);
    if (m && m.drive_modified === k.modifiedTime && have) { stats.unchanged++; if (priv) stats.mine++; continue; }
    if (have && !m) {
      // déjà sur le site sans lien avec le Drive : on le reconnaît sans le recopier
      // (cours : même taille ; perso : la version du site est plus récente que celle du Drive)
      const same = !priv ? (!exp && k.size != null && String(have.size) === String(k.size)) : new Date(have.modified) >= new Date(k.modifiedTime);
      if (same) { const mm = { file_id: id, drive_id: k.id, drive_modified: k.modifiedTime, kind: 'file', owner: have.owner }; await putMap(mm); map.set(id, mm); stats.unchanged++; if (priv) stats.mine++; continue; }
    }
    // fichier perso modifié sur le site après le Drive : on garde la version du site
    if (priv && have && new Date(have.modified) > new Date(k.modifiedTime)) { const mm = { file_id: id, drive_id: k.id, drive_modified: k.modifiedTime, kind: 'file', owner: me }; await putMap(mm); map.set(id, mm); stats.unchanged++; stats.mine++; continue; }
    if (Date.now() - t0 > budgetMs) { partial = true; continue; } // la suite au prochain passage
    const limit = priv ? MAX_PRIVATE : MAX_BYTES;
    if (!exp && Number(k.size || 0) > limit) { stats.skipped++; stats.errors.push(it.name + ' : trop gros'); continue; }
    try {
      const r = await gfetch(tok, exp ? `${G}/${k.id}/export?mimeType=${encodeURIComponent(exp[0])}` : `${G}/${k.id}?alt=media&supportsAllDrives=true`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const mime = exp ? exp[0] : mimeOf(it.name);
      const row: any = { id, owner: priv ? me : null, parent, name: it.name, mime, size: bytes.length, modified: k.modifiedTime, content: null, storage_path: null };
      if (TEXT_EXT.test(it.name) && bytes.length < 2500000) row.content = dec.decode(bytes);
      else {
        row.storage_path = priv ? 'perso/' + me + '/' + id : 'cours/' + id;
        const up = await fetch(URL_ + '/storage/v1/object/' + row.storage_path, { method: 'POST', headers: { ...svcHeaders(), 'Content-Type': mime, 'x-upsert': 'true' }, body: bytes });
        if (!up.ok) throw new Error('stockage : ' + up.status + ' ' + (await up.text()).slice(0, 120));
      }
      if (have?.storage_path && have.storage_path !== row.storage_path) await storageDelete(have.storage_path);
      await upsertFile(row);
      const mm = { file_id: id, drive_id: k.id, drive_modified: k.modifiedTime, kind: 'file', owner: row.owner }; await putMap(mm); map.set(id, mm);
      if (have) stats.updated++; else stats.added++;
      if (priv) stats.mine++;
      remember(row);
    } catch (e) { stats.errors.push(it.name + ' : ' + (e as Error).message); partial = true; }
  }

  // 5) ce qui a disparu du Drive (seulement après un parcours complet, et jamais tout d'un coup)
  if (!partial) {
    const gone = [...map.values()].filter(m => !seen.has(m.file_id));
    if (gone.length && !items.length && !driveDirs.size) stats.errors.push('le Drive semble vide : rien n\'a été supprimé par prudence');
    else for (const m of gone.sort((a, b) => (a.kind === 'folder' ? 1 : 0) - (b.kind === 'folder' ? 1 : 0))) {
      const f = rows.get(m.file_id);
      const dropMap = () => svc('/rest/v1/drive_map?file_id=eq.' + encodeURIComponent(m.file_id), { method: 'DELETE' });
      if (!f) { await dropMap(); continue; }
      if (m.kind === 'folder') {
        const left = await svcJson(`/rest/v1/files?parent=eq.${encodeURIComponent(m.file_id)}&select=id&limit=1`);
        if (left.length) { await dropMap(); continue; } // il contient encore des fichiers (importés à la main, créés sur le site…) : on le garde
      } else if (f.owner && new Date(f.modified) > new Date(m.drive_modified)) { await dropMap(); continue; } // perso modifié sur le site : on le garde
      if (f.storage_path) await storageDelete(f.storage_path);
      await svc('/rest/v1/files?id=eq.' + encodeURIComponent(m.file_id) + (f.owner ? '&owner=eq.' + f.owner : '&owner=is.null'), { method: 'DELETE' });
      await dropMap();
      stats.removed++;
    }
  }
  const result = { ...stats, partial, folder: root.name, ms: Date.now() - t0 };
  await saveState({ folder_name: root.name, last_run: new Date().toISOString(), last_result: result, ...(partial ? {} : { last_ok: new Date().toISOString() }) });
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch { /* vide */ }

  // qui appelle ? la tâche planifiée (clé) ou l'admin connecté
  const st = await state().catch(() => null);
  const key = req.headers.get('x-sync-key') || '';
  const byCron = !!(key && st?.sync_key && key === st.sync_key);
  if (!byCron) {
    const who = await fetch(URL_ + '/auth/v1/user', { headers: { Authorization: req.headers.get('Authorization') || '', apikey: ANON } });
    if (!who.ok) return json({ error: 'non connecté' }, 401);
    const me = await who.json();
    const pr = await svcJson('/rest/v1/profiles?select=is_admin&id=eq.' + me.id).catch(() => []);
    if (!pr[0]?.is_admin) return json({ error: 'réservé à l\'administrateur' }, 403);
  }
  if (!st) return json({ error: 'la table sync_state manque : relance supabase/setup.sql' }, 500);
  const action = byCron ? 'run' : body.action || 'status';

  if (action === 'status' || action === 'cleanup') {
    // « orphelins » : cours partagés qui ne viennent pas du Drive (anciens imports à la main absents du Drive)
    let orphans: any[] = [];
    if (st.last_ok) {
      const shared: any[] = await svcJson('/rest/v1/files?owner=is.null&select=id,name,mime,parent,storage_path&limit=5000');
      const mapped = new Set((await svcJson('/rest/v1/drive_map?select=file_id')).map((m: any) => m.file_id));
      orphans = shared.filter(f => f.id !== ROOT_ID && !mapped.has(f.id) && f.mime !== FOLDER);
      if (action === 'cleanup') {
        for (const f of orphans) {
          if (f.storage_path) { const [bucket, ...p] = f.storage_path.split('/'); await fetch(URL_ + '/storage/v1/object/' + bucket, { method: 'DELETE', headers: { ...svcHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [p.join('/')] }) }); }
          await svc('/rest/v1/files?owner=is.null&id=eq.' + encodeURIComponent(f.id), { method: 'DELETE' });
        }
        // puis les dossiers vides qui ne viennent pas du Drive
        let removedDirs = 0;
        for (let pass = 0; pass < 10; pass++) {
          const left: any[] = await svcJson('/rest/v1/files?owner=is.null&select=id,parent,mime&limit=5000');
          const parents = new Set(left.map(f => f.parent));
          const empty = left.filter(f => f.mime === FOLDER && f.id !== ROOT_ID && !mapped.has(f.id) && !parents.has(f.id));
          if (!empty.length) break;
          for (const d of empty) { await svc('/rest/v1/files?owner=is.null&id=eq.' + encodeURIComponent(d.id), { method: 'DELETE' }); removedDirs++; }
        }
        return json({ ok: true, removed: orphans.length, removedDirs });
      }
    }
    const sa = robot();
    return json({ robot: sa && !(sa as any).bad ? sa.client_email : null, robotBad: !!(sa as any)?.bad, folderId: st.folder_id, folderName: st.folder_name,
      lastRun: st.last_run, lastOk: st.last_ok, last: st.last_result, auto: st.auto, orphans: orphans.length, orphanNames: orphans.slice(0, 8).map(f => f.name) });
  }
  if (action === 'folder') {
    const m = /[-\w]{20,}/.exec(String(body.folder || '').replace(/.*\/folders\//, '').split(/[?#]/)[0]);
    if (!m) return json({ error: 'colle le lien du dossier Google Drive' }, 400);
    await saveState({ folder_id: m[0], folder_name: null });
    return json({ ok: true, folderId: m[0] });
  }
  if (action === 'auto') { await saveState({ auto: !!body.on }); return json({ ok: true, auto: !!body.on }); }
  if (action === 'run') {
    if (byCron && !st.auto) return json({ ok: true, off: true });
    try { return json({ ok: true, ...(await run(byCron ? 110000 : 45000)) }); }
    catch (e) {
      const msg = (e as Error).message;
      await saveState({ last_run: new Date().toISOString(), last_result: { error: msg } }).catch(() => {});
      return json({ error: msg }, 400);
    }
  }
  return json({ error: 'action inconnue' }, 400);
});
