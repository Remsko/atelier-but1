/* =====================================================================
   Atelier BUT 1 — version site web
   Remplace l'environnement claude.ai : comptes (Supabase), fichiers par
   personne + bibliothèque de cours commune, emploi du temps Celcat par
   personne, téléchargements. Sans configuration : « mode local »
   (tout reste dans ce navigateur).
   Le site principal parle toujours « Google Drive » : cette couche
   répond aux mêmes appels (search_files, create_file…) avec nos données.
   ===================================================================== */
(function () {
'use strict';
const CFG = Object.assign({ loginPattern: '{login}@atelier-but1.invalid', siteName: 'Atelier BUT 1', adminContact: '' }, window.ATELIER_CONFIG || {});
if (CFG.loginDomain && !(window.ATELIER_CONFIG || {}).loginPattern) CFG.loginPattern = '{login}@' + CFG.loginDomain;
const emailOf = login => login.includes('@') ? login : CFG.loginPattern.replace('{login}', login);
const ONLINE = !!(CFG.supabaseUrl && CFG.supabaseKey);
const FOLDER = 'application/vnd.google-apps.folder';
const ROOT_ID = 'but1';
const TEXT_EXT = /\.(c|cc|cpp|cxx|h|hpp|hh|txt|md|sql|csv|tsv|json|html?|css|js|mjs|py|java|sh|xml|svg|ics|ini|cfg|log)$/i;
const PRIVATE_NAME = /corrig|correction|r[ée]ponse|solution|rendu|brouillon|perso/i;
// ce qu'on partage par défaut : sujets, cours, documents, images, tables SQL — jamais le code ni les fichiers perso
const SHARE_OK = /\.(pdf|docx?|pptx?|xlsx?|odt|odp|ods|rtf|png|jpe?g|gif|webp|svg|sql|csv|tsv)$/i;
const SITE_DOC_RE = /atelier but ?1|emploi du temps/i;
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) { const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const newId = () => 'f' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder(), dec = new TextDecoder('utf-8');
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const err = (code, message, retryable) => Object.assign(new Error(message || code), { code, retryable: !!retryable });
const mimeOf = name => { const e = (/\.([^.]+)$/.exec(name) || [, ''])[1].toLowerCase();
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', csv: 'text/csv', md: 'text/markdown', sql: 'text/plain',
    zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[e] || (TEXT_EXT.test(name) ? 'text/plain' : 'application/octet-stream'); };

/* ---------------- état ---------------- */
const W = window.__web = { online: ONLINE, cfg: CFG, user: null, profile: null, ns: 'but1:local:', isAdmin: !ONLINE, iaOn: ONLINE && !!CFG.ia };
let sb = null;

/* =====================================================================
   Stockage : deux « moteurs » avec la même interface
   rows : { id, owner, parent, name, mime, content, storage_path, size, modified }
   ===================================================================== */
// ---------- local (IndexedDB) ----------
const Local = {
  dbP: null,
  db() {
    if (!this.dbP) this.dbP = new Promise((res, rej) => {
      const r = indexedDB.open('atelier-but1-local', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('files', { keyPath: 'id' }); d.createObjectStore('blobs'); d.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.dbP;
  },
  async tx(store, mode, fn) {
    const d = await this.db();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); let out; Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); });
  },
  req: r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async list() {
    const rows = await this.tx('files', 'readonly', s => this.req(s.getAll()));
    if (!rows.some(r => r.id === ROOT_ID)) { const root = { id: ROOT_ID, owner: null, parent: '', name: 'BUT 1', mime: FOLDER, modified: new Date().toISOString() }; await this.put(root); rows.push(root); }
    return rows;
  },
  async put(row) { await this.tx('files', 'readwrite', s => { s.put(row); }); return row; },
  async insert(row) { return this.put(row); },
  async update(id, patch) { const r = await this.tx('files', 'readonly', s => this.req(s.get(id))); if (!r) throw err('tool_error', 'fichier introuvable'); return this.put(Object.assign(r, patch)); },
  async remove(row) { await this.tx('files', 'readwrite', s => { s.delete(row.id); }); if (row.storage_path && !(await this.list()).some(x => x.storage_path === row.storage_path)) await this.tx('blobs', 'readwrite', s => { s.delete(row.storage_path); }); },
  async getBlob(path) { const b = await this.tx('blobs', 'readonly', s => this.req(s.get(path))); if (!b) throw err('tool_error', 'fichier absent'); return new Uint8Array(b); },
  async putBlob(path, bytes) { await this.tx('blobs', 'readwrite', s => { s.put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), path); }); },
  canEditShared: () => true,
  async kvGet(k) { return this.tx('kv', 'readonly', s => this.req(s.get(k))); },
  async kvSet(k, v) { return this.tx('kv', 'readwrite', s => { s.put(v, k); }); }
};
// ---------- en ligne (Supabase) ----------
const net = e => { const m = String(e && (e.message || e) || ''); return /fetch|network|Failed|Load failed|timeout/i.test(m) ? err('server_unavailable', 'connexion au serveur impossible', true) : err('tool_error', m.slice(0, 160)); };
const Online = {
  async list() {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await sb.from('files').select('*').order('id').range(from, from + step - 1);
      if (error) throw net(error); out.push(...data); if (data.length < step) break;
    }
    const { data: hd, error: he } = await sb.from('hides').select('file_id'); if (he) throw net(he);
    const hidden = new Set(hd.map(x => x.file_id));
    return out.filter(r => !hidden.has(r.id));
  },
  async insert(row) { const { data, error } = await sb.from('files').insert(row).select().single(); if (error) throw net(error); return data; },
  async update(id, patch) { const { data, error } = await sb.from('files').update(patch).eq('id', id).select(); if (error) throw net(error); if (!data.length) throw err('tool_error', 'modification refusée'); return data[0]; },
  async remove(row) {
    if (row.owner === W.user.id || (row.owner == null && W.isAdmin && W.adminMode)) {
      const { error } = await sb.from('files').delete().eq('id', row.id); if (error) throw net(error);
      if (row.storage_path && row.owner) { const [bucket, ...p] = row.storage_path.split('/'); await sb.storage.from(bucket).remove([p.join('/')]).catch(() => {}); }
    } else { const { error } = await sb.from('hides').upsert({ owner: W.user.id, file_id: row.id }); if (error) throw net(error); }
  },
  async getBlob(path) { const [bucket, ...p] = path.split('/'); const { data, error } = await sb.storage.from(bucket).download(p.join('/')); if (error) throw net(error); return new Uint8Array(await data.arrayBuffer()); },
  async putBlob(path, bytes, mime) { const [bucket, ...p] = path.split('/'); const { error } = await sb.storage.from(bucket).upload(p.join('/'), new Blob([bytes], { type: mime || 'application/octet-stream' }), { upsert: true, contentType: mime || 'application/octet-stream' }); if (error) throw net(error); },
  canEditShared: () => W.isAdmin && W.adminMode
};
const B = () => ONLINE ? Online : Local;
const me = () => ONLINE ? W.user.id : 'local';

/* ---------- cache de la liste (un appel réseau par synchro) ---------- */
let cache = null, cacheAt = 0, cacheP = null;
async function rows(force) {
  if (!force && cache && Date.now() - cacheAt < 4000) return cache;
  if (!cacheP) cacheP = B().list().then(r => { cache = new Map(r.map(x => [x.id, x])); cacheAt = Date.now(); cacheP = null; return cache; }, e => { cacheP = null; throw e; });
  return cacheP;
}
const touch = row => { if (cache) cache.set(row.id, row); };
const drop = id => { if (cache) cache.delete(id); };
const out = r => ({ id: r.id, title: r.name, name: r.name, mimeType: r.mime, parentId: r.parent, modifiedTime: r.modified, fileSize: r.size != null ? String(r.size) : undefined, shared: r.owner == null });
const isOwn = r => r.owner != null;

/* =====================================================================
   « Faux Google Drive » : mêmes outils, mêmes réponses
   ===================================================================== */
async function bytesOf(r) {
  if (r.content != null) return enc.encode(r.content);
  if (r.storage_path) return B().getBlob(r.storage_path);
  throw err('tool_error', 'ce fichier est vide');
}
async function newRow(o) {
  const id = newId();
  const row = { id, owner: ONLINE ? W.user.id : 'local', parent: o.parent, name: o.name, mime: o.mime || mimeOf(o.name), content: o.content == null ? null : o.content,
    storage_path: o.storage_path || null, size: o.size != null ? o.size : (o.content != null ? enc.encode(o.content).length : null), modified: new Date().toISOString() };
  if (o.bytes) { row.storage_path = (ONLINE ? 'perso/' + W.user.id : 'perso') + '/' + id; await B().putBlob(row.storage_path, o.bytes, row.mime); row.size = o.bytes.length; }
  const saved = await B().insert(row); touch(saved); return saved;
}
const DRIVE_TOOLS = {
  async search_files(i) {
    const all = await rows(true);
    const q = String(i.query || '');
    const parents = [...q.matchAll(/parentId\s*=\s*'([^']+)'/g)].map(m => m[1] === 'root' ? ROOT_ID : m[1]);
    const title = /title\s*=\s*'([^']*)'/.exec(q);
    let list = [...all.values()];
    if (parents.length) list = list.filter(r => parents.includes(r.parent));
    if (title) list = list.filter(r => r.name === title[1]);
    if (/sharedWithMe/.test(q)) list = [];
    if (/mimeType\s*=\s*'([^']+)'/.test(q)) { const m = /mimeType\s*=\s*'([^']+)'/.exec(q)[1]; list = list.filter(r => r.mime === m); }
    if (!parents.length && !title) list = list.filter(r => r.id !== ROOT_ID);
    return { files: list.map(out) };
  },
  async get_file_metadata(i) { const r = (await rows()).get(i.fileId); if (!r) throw err('tool_error', 'fichier introuvable'); return out(r); },
  async download_file_content(i) {
    const r = (await rows()).get(i.fileId) || (await rows(true)).get(i.fileId); if (!r) throw err('tool_error', 'fichier introuvable');
    return { content: b64(await bytesOf(r)), mimeType: r.mime };
  },
  async read_file_content(i) {
    const r = (await rows()).get(i.fileId); if (!r) throw err('tool_error', 'fichier introuvable');
    // PDF et autres : texte vide → le site extrait lui-même le texte avec pdf.js
    return { content: r.content != null ? r.content : '' };
  },
  async create_file(i) {
    const parent = i.parentId === 'root' || !i.parentId ? ROOT_ID : i.parentId;
    const mime = i.contentMimeType || mimeOf(i.title);
    if (mime === FOLDER) {
      // un seul dossier du même nom au même endroit (pratique quand on reprend une arborescence)
      const ex = [...(await rows()).values()].find(r => r.parent === parent && r.name === i.title && r.mime === FOLDER && isOwn(r));
      if (ex) return out(ex);
      return out(await newRow({ parent, name: i.title, mime: FOLDER }));
    }
    if (i.base64Content != null) return out(await newRow({ parent, name: i.title, mime, bytes: unb64(i.base64Content) }));
    return out(await newRow({ parent, name: i.title, mime, content: i.textContent != null ? String(i.textContent) : '' }));
  },
  async update_file(i) {
    const r = (await rows()).get(i.fileId); if (!r) throw err('tool_error', 'fichier introuvable');
    const patch = {};
    if (i.parentId) patch.parent = i.parentId === 'root' ? ROOT_ID : i.parentId;
    if (i.title) patch.name = i.title;
    if (i.textContent != null) { patch.content = String(i.textContent); patch.size = enc.encode(patch.content).length; }
    patch.modified = new Date().toISOString();
    if (isOwn(r) || B().canEditShared()) { const s = await B().update(r.id, patch); touch(s); return out(s); }
    // cours partagé : on garde sa propre copie modifiée, l'original est masqué pour cette personne
    const copy = await newRow(Object.assign({ parent: r.parent, name: r.name, mime: r.mime, content: r.content, storage_path: r.storage_path, size: r.size }, patch));
    await B().remove(r); drop(r.id);
    return out(copy);
  },
  async copy_file(i) {
    const r = (await rows()).get(i.fileId); if (!r) throw err('tool_error', 'fichier introuvable');
    return out(await newRow({ parent: i.parentId || r.parent, name: i.title || r.name, mime: r.mime, content: r.content, storage_path: r.storage_path, size: r.size }));
  },
  async trash_file(i) {
    const r = (await rows()).get(i.fileId); if (!r) return { ok: true };
    if (r.id === ROOT_ID) throw err('tool_error', 'impossible de supprimer la racine');
    // un dossier : on supprime aussi ce qu'il contient
    const all = await rows(); const kids = id => [...all.values()].filter(x => x.parent === id);
    const walk = async x => { for (const k of kids(x.id)) await walk(k); await B().remove(x); drop(x.id); };
    await walk(r);
    return { ok: true };
  }
};
const mcp = {
  async callTool(server, tool, input) {
    if (/gmail/i.test(server)) throw err('server_not_connected', 'Gmail n\'est pas disponible sur ce site');
    const f = DRIVE_TOOLS[tool]; if (!f) throw err('tool_error', 'outil indisponible : ' + tool);
    if (ONLINE && !navigator.onLine) throw err('server_unavailable', 'pas de connexion internet', true);
    try { return { payload: await f(input || {}) }; }
    catch (e) { if (e && e.code) throw e; throw net(e); }
  }
};
W.drive = DRIVE_TOOLS; W.rows = rows;


/* =====================================================================
   Assistant IA (fonction « ia » de Supabase → IA gratuite, Mistral par défaut)
   Même interface que l'IA de claude.ai : smp(texte|messages, options), smp.json(…), smp.limits()
   ===================================================================== */
const fnUrl = name => CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/' + name;
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function toMessages(input, images, json) {
  let msgs = typeof input === 'string' ? [{ role: 'user', content: input }] : (input || []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content == null ? '' : m.content) }));
  const sys = 'Tu réponds en français.' + (json ? ' Réponds UNIQUEMENT avec un objet JSON valide (pas de texte autour, pas de bloc ```).' : '');
  msgs = [{ role: 'system', content: sys }].concat(msgs);
  if (images && images.length) {
    const last = msgs[msgs.length - 1];
    const parts = [{ type: 'text', text: last.content }];
    for (const im of images.slice(0, 4)) parts.push({ type: 'image_url', image_url: { url: typeof im === 'string' ? im : await blobToDataUrl(im) } });
    last.content = parts;
  }
  return msgs;
}
function parseJsonLoose(t) {
  t = String(t || '').trim();
  const tryParse = x => { try { return JSON.parse(x); } catch (e) { return undefined; } };
  let v = tryParse(t); if (v !== undefined) return v;
  // bloc ```json … ``` n'importe où dans la réponse
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) { v = tryParse(fence[1].trim()); if (v !== undefined) return v; t = fence[1].trim(); }
  // du premier { (ou [) au dernier } (ou ])
  const a = t.search(/[{[]/); const b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) {
    let c = t.slice(a, b + 1);
    v = tryParse(c); if (v !== undefined) return v;
    // petites fautes courantes : virgule en trop, guillemets typographiques
    c = c.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
    v = tryParse(c); if (v !== undefined) return v;
  }
  throw new Error('json');
}
async function iaCall(input, opts, json) {
  opts = opts || {};
  const stream = !!opts.onText && !json;
  const body = JSON.stringify({ messages: await toMessages(input, opts.images, json), tier: opts.modelTier === 'quick' ? 'quick' : 'default', json, stream, maxTokens: opts.maxTokens });
  let r;
  try { r = await fetch(fnUrl('ia'), { method: 'POST', signal: opts.signal, headers: { Authorization: 'Bearer ' + await token(), apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body }); }
  catch (e) { if (e && e.name === 'AbortError') throw err('cancelled', 'Annulé.'); throw err('server_unavailable', 'connexion à l\'IA impossible', true); }
  if (!r.ok) {
    let j = {}; try { j = await r.json(); } catch (e) {}
    const e = (j && j.error) || {}; const m = String(e.message || ('erreur ' + r.status)); const msg = m.charAt(0).toUpperCase() + m.slice(1) + (/[.!?]$/.test(m) ? '' : '.');
    // messages précis (quota du jour, IA pas configurée…) affichés tels quels ; les autres codes gardent le texte habituel du site
    throw err(['prompt_too_large', 'image_rejected', 'invalid_request', 'cancelled'].includes(e.code) ? e.code : 'own', msg);
  }
  if (!stream) { const j = await r.json(); return { text: j.text || '', truncated: !!j.truncated, model: j.model || '' }; }
  // flux « data: {...} » : on affiche au fur et à mesure
  const rd = r.body.getReader(); let buf = '', text = '', truncated = false;
  try {
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); const c = j.choices && j.choices[0]; const t = c && c.delta && c.delta.content; if (c && c.finish_reason === 'length') truncated = true;
          if (t) { text += t; opts.onText({ text }); } } catch (e) {}
      }
    }
  } catch (e) { if (e && e.name === 'AbortError') throw Object.assign(err('cancelled', 'Annulé.'), { text }); throw Object.assign(err('server_unavailable', 'réponse interrompue'), { text }); }
  if (!text) throw err('empty_completion', 'pas de réponse');
  return { text, truncated };
}
const sampler = (input, opts) => iaCall(input, opts, false);
sampler.json = async (input, opts) => {
  opts = opts || {};
  let r = await iaCall(input, Object.assign({}, opts, { maxTokens: opts.maxTokens || 8000 }), true);
  if (!r.truncated) { try { return parseJsonLoose(r.text); } catch (e) {} }
  // réponse coupée ou pas du JSON : on redemande une fois, plus clairement et avec plus de place
  const again = (typeof input === 'string' ? input : (input || []).map(m => (m.role === 'assistant' ? 'Réponse : ' : '') + m.content).join('\n\n')) +
    '\n\nIMPORTANT : réponds UNIQUEMENT avec l\'objet JSON complet et valide, sans texte avant ni après, sans bloc ```. Reste concis pour que la réponse ne soit pas coupée.';
  r = await iaCall(again, Object.assign({}, opts, { maxTokens: 16000, onText: null }), true);
  try { return parseJsonLoose(r.text); } catch (e) { throw err('invalid_json', 'réponse mal formée'); }
};
sampler.limits = async () => ({ images: { maxCount: 4, mediaTypes: ['image/jpeg', 'image/png'], maxInputBytes: 3500000 } });
W.ia = sampler;
W.iaUsage = async () => { const r = await fetch(fnUrl('ia'), { method: 'POST', headers: { Authorization: 'Bearer ' + await token(), apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'usage' }) }); return r.json(); };

/* ---------- « Continuer sur Claude » : la question toute prête, sur le compte Claude de la personne ---------- */
W.handoff = function (prompt) {
  const text = String(prompt).replace(/\n{3,}/g, '\n\n').trim();
  const ov = h('div', { class: 'w-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Continuer sur Claude' });
  const closeIt = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') closeIt(); }; document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) closeIt(); });
  const enc_ = encodeURIComponent(text);
  const url = enc_.length < 7000 ? 'https://claude.ai/new?q=' + enc_ : 'https://claude.ai/new';
  const prefilled = enc_.length < 7000;
  const ta = h('textarea', { class: 'w-input w-hand', readonly: true, rows: 9 }); ta.value = text;
  const status = h('div', { class: 'w-status', role: 'status' });
  const go = h('button', { class: 'btn primary', type: 'button' }, 'Copier et ouvrir Claude ↗');
  go.addEventListener('click', () => {
    let copied = false;
    try { ta.select(); copied = document.execCommand('copy'); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => {}, () => {});
    window.open(url, '_blank', 'noopener');
    status.textContent = prefilled ? 'Claude s\'ouvre avec ta question. Si elle n\'apparaît pas, colle-la (Ctrl+V).' : 'Question copiée : dans Claude, colle-la (Ctrl+V ou appui long → Coller) puis envoie.';
  });
  ov.append(h('div', { class: 'w-card w-hand-card' },
    h('div', { class: 'w-top' }, h('div', null, h('div', { class: 'eyebrow', text: 'Aide' }), h('h1', { class: 'f-title', text: 'Continuer sur Claude' })), h('button', { class: 'icon-btn w-x', type: 'button', 'aria-label': 'Fermer', onclick: closeIt }, '✕')),
    h('p', { class: 'w-lead' }, 'Ta question est prête, avec le sujet, ton code et les règles du tuteur (des indices, pas la réponse toute faite). Elle s\'ouvre dans ', h('b', null, 'ton'), ' compte Claude : le compte gratuit suffit.'),
    ta, h('div', { class: 'w-row' }, go), status,
    h('p', { class: 'w-note' }, 'Pas encore de compte ? Crée-le gratuitement sur claude.ai. Rien n\'est envoyé tant que tu n\'appuies pas sur Envoyer dans Claude.')));
  document.body.append(ov);
  setTimeout(() => go.focus(), 30);
};


/* ---------- encadré « Aide de Claude » sur les dossiers de TD/TP (quand l'IA n'est pas intégrée) ---------- */
const HELP_RULES = "Tu es le tuteur d'un étudiant de BUT Informatique 1re année (IUT). Réponds en français, tutoiement, mots simples. Ne donne PAS les réponses ni le code corrigé tout fait, sauf si je te le demande explicitement : guide-moi avec des questions et des indices, une étape à la fois. Le code se fait en C++ (cout, cin) sauf si le sujet dit autre chose.";
W.helpBox = function (o) {
  const status = h('div', { class: 'w-status', role: 'status' });
  const make = async (btn, task, needAnswers) => {
    btn.disabled = true; status.textContent = 'Préparation de la question (lecture du sujet)…';
    try {
      const ans = o.answers ? String(o.answers() || '').trim() : '';
      if (needAnswers && !ans) { status.textContent = 'Écris d\'abord au moins une réponse, puis reviens ici.'; return; }
      const docs = String(await o.docs() || '').trim();
      const files = o.files ? String(o.files() || '').trim() : '';
      let p = HELP_RULES + '\n\n### Dossier\n' + o.path + '\n\n';
      p += docs ? '### Sujet et documents\n' + docs.slice(0, 30000) + '\n\n' : '### Sujet\n(le texte du sujet n\'a pas pu être lu : je te le décris si besoin)\n\n';
      if (files) p += '### Mes fichiers\n' + files.slice(0, 12000) + '\n\n';
      if (ans) p += '### Mes réponses\n' + ans.slice(0, 15000) + '\n\n';
      p += '### Demande\n' + task;
      status.textContent = '';
      W.handoff(p);
    } catch (e) { status.textContent = 'Impossible de préparer la question : ' + (e.message || e); }
    finally { btn.disabled = false; }
  };
  const B = (label, task, primary, needAnswers) => { const b = h('button', { class: 'btn' + (primary ? ' primary' : ''), type: 'button' }, label); b.addEventListener('click', () => make(b, task, needAnswers)); return b; };
  const btns = [
    B('Comprendre le sujet ↗', 'Explique-moi en quelques lignes ce que demande ce sujet et liste les exercices. Puis demande-moi par lequel je veux commencer, et guide-moi pas à pas, sans me donner les réponses.', true),
    o.answers ? B('Corriger mes réponses ↗', 'Corrige mes réponses exercice par exercice : ✅ juste / ⚠️ incomplet / ❌ faux, avec une explication simple. Pour ce qui est faux, donne-moi un indice pour corriger, pas la réponse toute faite.', false, true) : null,
    B('Quiz ↗', 'Fais-moi réviser ce dossier : pose-moi 5 questions à choix multiples, UNE à la fois. Attends ma réponse, corrige-la en expliquant, puis passe à la suivante. À la fin, donne mon score et les notions à revoir.'),
    B('Fiche de révision ↗', 'Rédige une fiche de révision d\'une page sur les notions de ce dossier : à retenir, syntaxe utile avec de petits exemples, méthode, pièges classiques. Pas les réponses des exercices.')
  ];
  return h('section', { class: 'w-help' },
    h('div', { class: 'w-help-t' }, h('b', null, 'Aide de Claude'), h('span', { class: 'muted' }, ' · la question s\'ouvre dans ton compte Claude (gratuit), avec le sujet déjà dedans')),
    h('div', { class: 'w-row' }, btns), status);
};

/* ---------- téléchargements ---------- */
function saveFile(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : data], { type: mime || mimeOf(name) });
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const downloads = { async save(o) { saveFile(o.filename || 'fichier', o.data, o.mimeType); return { ok: true }; } };

/* ---------- l'API window.claude attendue par le site ---------- */
window.claude = {
  use(cap) {
    if (cap === 'mcp') return Promise.resolve(mcp);
    if (cap === 'downloads') return Promise.resolve(downloads);
    if (cap === 'permissions') return Promise.resolve({ state: async () => 'granted', request: async () => 'granted' });
    if (cap === 'sample' && W.iaOn) return Promise.resolve(sampler);
    return Promise.reject(err('not_declared', 'indisponible sur ce site'));
  }
};

/* =====================================================================
   ZIP (lecture pour l'import des cours, écriture pour l'export)
   ===================================================================== */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipWrite(entries) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const nb = enc.encode(name), c = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, c, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, c, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
async function zipRead(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf); let e = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('ce fichier n\'est pas un .zip valide');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const nameB = u.subarray(p + 46, p + 46 + nl); const name = flags & 0x800 ? dec.decode(nameB) : dec.decode(nameB);
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u.subarray(ds, ds + csz);
    out.push({ name, read: async () => {
      if (method === 0) return raw.slice();
      if (method === 8) return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      throw new Error('compression non gérée pour ' + name);
    } });
  }
  return out;
}
W.zipWrite = zipWrite; W.zipRead = zipRead;

/* =====================================================================
   Emploi du temps : relais (en ligne) ou fichier .ics importé (local)
   ===================================================================== */
async function token() { const { data } = await sb.auth.getSession(); return data.session && data.session.access_token; }
W.edtFetch = async function (signal, testUrl) {
  if (ONLINE) {
    if (!testUrl && !(W.profile && W.profile.celcat_url)) return { ok: false, status: 404, text: async () => '' };
    const r = await fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/edt', { method: testUrl ? 'POST' : 'GET', signal,
      headers: { Authorization: 'Bearer ' + await token(), apikey: CFG.supabaseKey, 'Content-Type': 'application/json' }, body: testUrl ? JSON.stringify({ url: testUrl }) : undefined });
    return r;
  }
  const ics = await Local.kvGet('edt:ics');
  return { ok: !!ics, status: ics ? 200 : 404, text: async () => ics || '' };
};
const CELCAT_RE = /^(https?|webcal):\/\/[^\s]*celcat[^\s]*$/i;
W.edtSetup = function (el, compact) {
  const has = ONLINE ? !!(W.profile && W.profile.celcat_url) : null;
  const box = h('section', { class: 'w-edt' + (compact ? ' compact' : '') });
  const status = h('div', { class: 'w-status', role: 'status' });
  const input = h('input', { type: 'url', class: 'w-input', placeholder: 'https://extra.u-picardie.fr/celcat-feed/ical/…/schedule.ics', 'aria-label': 'Lien de ton emploi du temps', value: (W.profile && W.profile.celcat_url) || '' });
  const save = h('button', { class: 'btn primary', type: 'button' }, has ? 'Mettre à jour le lien' : 'Enregistrer mon emploi du temps');
  const file = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true });
  const fileBtn = h('button', { class: 'btn', type: 'button' }, 'Importer un fichier .ics');
  fileBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return; const t = await f.text();
    if (!/BEGIN:VCALENDAR/.test(t)) { status.textContent = 'Ce fichier n\'est pas un calendrier .ics.'; return; }
    await Local.kvSet('edt:ics', t); status.textContent = 'Calendrier importé.'; if (W.edtRefresh) W.edtRefresh();
  });
  save.addEventListener('click', async () => {
    const url = input.value.trim().replace(/^webcal:/i, 'https:');
    if (!CELCAT_RE.test(url)) { status.textContent = 'Ce lien ne ressemble pas à un lien Celcat : il doit commencer par https:// et contenir « celcat ».'; return; }
    save.disabled = true; status.textContent = 'Vérification du lien…';
    try {
      const r = await W.edtFetch(undefined, url);
      if (!r.ok) { let m = 'Celcat ne répond pas'; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
      const t = await r.text(); const n = (t.match(/BEGIN:VEVENT/g) || []).length;
      const { error } = await sb.from('profiles').update({ celcat_url: url }).eq('id', W.user.id); if (error) throw error;
      W.profile.celcat_url = url;
      status.textContent = 'C\'est bon : ' + n + ' cours trouvés. Ton emploi du temps se mettra à jour tout seul.';
      if (W.edtRefresh) W.edtRefresh();
    } catch (e) { status.textContent = 'Échec : ' + (e.message || e); }
    save.disabled = false;
  });
  const steps = h('ol', { class: 'w-steps' },
    h('li', null, 'Va sur ton ', h('b', null, 'ENT'), ' et ouvre ton ', h('b', null, 'emploi du temps Celcat'), '.'),
    h('li', null, 'Cherche le bouton ', h('b', null, '« S\'abonner »'), ' ou ', h('b', null, '« Exporter / iCal »'), ' (souvent une icône de calendrier en haut de l\'emploi du temps).'),
    h('li', null, 'Copie le lien qui apparaît. Il ressemble à ', h('code', null, 'https://extra.u-picardie.fr/celcat-feed/ical/…/schedule.ics'), ' (s\'il commence par ', h('code', null, 'webcal://'), ', ce n\'est pas grave).'),
    h('li', null, 'Colle-le ci-dessous et clique sur ', h('b', null, 'Enregistrer'), '. C\'est tout : il se met à jour tout seul, sur tous tes appareils.'));
  const note = h('p', { class: 'w-note' }, 'Ce lien donne seulement tes cours, en lecture. Ne colle ', h('b', null, 'jamais'), ' ton mot de passe de l\'ENT ici : le site n\'en a pas besoin. Ce lien est personnel : ne le partage pas.');
  if (compact) {
    const det = h('details', { class: 'w-det' }, h('summary', null, 'Changer mon lien d\'emploi du temps'), steps, h('div', { class: 'w-row' }, input, save), status);
    if (!ONLINE) { det.querySelector('.w-row').replaceWith(h('div', { class: 'w-row' }, fileBtn, file)); }
    box.append(det); return box;
  }
  box.append(h('h2', { class: 'w-h' }, 'Ajoute ton emploi du temps'),
    h('p', { class: 'w-lead' }, 'Chacun a son propre emploi du temps : le site affiche le tien, sur l\'accueil, dans cette page et dans tes évaluations.'), steps);
  if (ONLINE) box.append(h('div', { class: 'w-row' }, input, save), note, status);
  else box.append(h('p', { class: 'w-lead' }, 'En mode local, le site ne peut pas lire Celcat tout seul : télécharge le fichier .ics depuis Celcat puis importe-le.'), h('div', { class: 'w-row' }, fileBtn, file), status);
  return box;
};

/* =====================================================================
   Compte (dans le Guide → Réglages)
   ===================================================================== */
async function exportMine(btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Préparation…';
  try {
    const all = await rows(true); const byId = all;
    const pathOf = r => { const seg = []; let x = r; let g = 0; while (x && x.id !== ROOT_ID && g++ < 40) { seg.unshift(x.name.replace(/[\\/:*?"<>|]+/g, '_')); x = byId.get(x.parent); } return 'BUT 1/' + seg.join('/'); };
    const mine = [...all.values()].filter(r => (ONLINE ? r.owner === W.user.id : r.owner === 'local') && r.mime !== FOLDER);
    const entries = [];
    for (const r of mine) { try { entries.push([pathOf(r), await bytesOf(r)]); } catch (e) {} }
    if (!entries.length) { btn.textContent = 'Rien à exporter pour l\'instant'; setTimeout(() => { btn.textContent = t; btn.disabled = false; }, 2500); return; }
    saveFile('atelier-but1-' + (W.profile && W.profile.login || 'mes-fichiers') + '-' + new Date().toISOString().slice(0, 10) + '.zip', zipWrite(entries));
  } catch (e) { alertBox('Export impossible : ' + (e.message || e)); }
  btn.textContent = t; btn.disabled = false;
}
function alertBox(msg) { const t = document.getElementById('toast'); if (t) { t.textContent = msg; t.hidden = false; clearTimeout(alertBox.t); alertBox.t = setTimeout(() => { t.hidden = true; }, 3200); } }
W.accountPanel = function () {
  const box = h('div', { class: 'g-set share-set w-account' });
  const exp = h('button', { class: 'btn', type: 'button', onclick: e => exportMine(e.currentTarget) }, 'Télécharger mes fichiers (.zip)');
  if (!ONLINE) {
    box.append(h('div', null, h('b', null, 'Mode local'),
      h('div', { class: 'muted', text: 'Ce site n\'est pas encore relié à un serveur : tes fichiers sont enregistrés seulement dans ce navigateur, sur cet ordinateur. Pense à les télécharger de temps en temps.' })),
      h('div', { class: 'share-btns' }, exp, h('button', { class: 'btn', type: 'button', onclick: () => W.openAdmin('cours') }, 'Importer des cours')));
    return box;
  }
  const status = h('div', { class: 'muted share-status', role: 'status' });
  const pw1 = h('input', { type: 'password', class: 'w-input', placeholder: 'Nouveau mot de passe (8 caractères min.)', autocomplete: 'new-password' });
  const pw2 = h('input', { type: 'password', class: 'w-input', placeholder: 'Confirme le mot de passe', autocomplete: 'new-password' });
  const chg = h('button', { class: 'btn', type: 'button' }, 'Changer');
  chg.addEventListener('click', async () => {
    if (pw1.value.length < 8) { status.textContent = 'Au moins 8 caractères.'; return; }
    if (pw1.value !== pw2.value) { status.textContent = 'Les deux mots de passe sont différents.'; return; }
    chg.disabled = true; const { error } = await sb.auth.updateUser({ password: pw1.value }); chg.disabled = false;
    status.textContent = error ? 'Échec : ' + error.message : 'Mot de passe changé.'; if (!error) { pw1.value = pw2.value = ''; }
  });
  const out_ = h('button', { class: 'btn', type: 'button', onclick: W.logout }, 'Se déconnecter');
  const p = W.profile || {};
  box.append(h('div', null, h('b', null, 'Mon compte'),
    h('div', { class: 'muted' }, 'Connecté en tant que ', h('b', null, p.display_name || p.login || ''), ' (identifiant ', h('code', null, p.login || ''), '). Tes fichiers sont enregistrés en ligne : tu les retrouves sur n\'importe quel ordinateur ou téléphone en te connectant.'),
    h('details', { class: 'w-det' }, h('summary', null, 'Changer mon mot de passe'), h('div', { class: 'w-row' }, pw1, pw2, chg)), status),
    h('div', { class: 'share-btns' }, exp, W.isAdmin ? h('button', { class: 'btn primary', type: 'button', onclick: () => W.openAdmin('comptes') }, 'Administration') : null, out_));
  return box;
};

/* =====================================================================
   Administration : comptes + bibliothèque de cours
   ===================================================================== */
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('admin', { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (e) {} throw new Error(m); }
  return data;
}
const genPw = () => { const a = 'abcdefghjkmnpqrstuvwxyz', d = '23456789'; const r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  let s = ''; for (let i = 0; i < 4; i++) s += a[r(a.length)]; s += '-'; for (let i = 0; i < 4; i++) s += d[r(d.length)]; s += '-'; for (let i = 0; i < 4; i++) s += a[r(a.length)]; return s; };
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
/*@@BENCH@@*/
W.openAdmin = function (tab) {
  if (!W.isAdmin) return;
  const ov = h('div', { class: 'w-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Administration' });
  const close = h('button', { class: 'icon-btn w-x', type: 'button', 'aria-label': 'Fermer', onclick: () => { ov.remove(); document.removeEventListener('keydown', onKey); } }, '✕');
  const onKey = e => { if (e.key === 'Escape') close.click(); }; document.addEventListener('keydown', onKey);
  const tabs = h('div', { class: 'w-tabs', role: 'tablist' });
  const body = h('div', { class: 'w-body' });
  const T = { comptes: 'Comptes', cours: 'Cours partagés', conso: 'Consommation', ia: 'IA' };
  const show = k => { tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.k === k)); body.textContent = ''; ({ comptes: accountsTab, cours: coursTab, conso: consoTab, ia: benchTab })[k](body); };
  for (const k of ONLINE ? (W.iaOn ? ['comptes', 'cours', 'conso', 'ia'] : ['comptes', 'cours']) : ['cours']) tabs.append(h('button', { type: 'button', role: 'tab', 'data-k': k, onclick: () => show(k) }, T[k]));
  ov.append(h('div', { class: 'w-card' }, h('div', { class: 'w-top' }, h('div', null, h('div', { class: 'eyebrow', text: CFG.siteName }), h('h1', { class: 'f-title', text: 'Administration' })), close), tabs, body));
  document.body.append(ov);
  show(ONLINE ? (tab || 'comptes') : 'cours');
};
/* ---------- consommation de l'IA par personne (tables ia_cost et ia_usage) ---------- */
function consoTab(body) {
  const RATE_KEY = 'atelier-but1-usd-eur';
  let rate = 0.86; try { rate = +localStorage.getItem(RATE_KEY) || rate; } catch (e) { /* */ }
  const now = new Date();
  const months = [...Array(6)].map((_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));
  const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const sel = h('select', { class: 'w-input', 'aria-label': 'Mois' }, ...months.map(d => h('option', { value: ym(d) }, d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }))));
  const rateIn = h('input', { class: 'w-input', type: 'number', step: '0.01', min: '0.5', max: '1.5', value: String(rate), style: 'max-width:110px', 'aria-label': 'Valeur d\'un dollar en euros' });
  const out = h('div'); const status = h('div', { class: 'w-status', role: 'status' });
  const usd = x => x.toLocaleString('fr-FR', { minimumFractionDigits: x < 1 ? 3 : 2, maximumFractionDigits: x < 1 ? 3 : 2 }) + ' $';
  const eur = x => (x * rate).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const tok = n => n >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n);
  const short = m => /sonnet/i.test(m) ? 'Sonnet' : /haiku/i.test(m) ? 'Haiku' : /opus/i.test(m) ? 'Opus' : m;
  const load = async () => {
    status.textContent = 'Chargement…'; out.textContent = '';
    const [y, m] = sel.value.split('-').map(Number);
    const from = sel.value + '-01', to = ym(new Date(y, m, 1)) + '-01';
    try {
      const [c, u, p] = await Promise.all([
        sb.from('ia_cost').select('*').gte('day', from).lt('day', to),
        sb.from('ia_usage').select('owner,day,count').gte('day', from).lt('day', to),
        sb.from('profiles').select('id,login,display_name')]);
      if (c.error) throw new Error(/ia_cost/.test(c.error.message) ? 'la table ia_cost n\'existe pas encore (voir supabase/setup.sql)' : c.error.message);
      const who = new Map((p.data || []).map(x => [x.id, x]));
      const per = new Map();
      const get = id => { if (!per.has(id)) per.set(id, { id, req: 0, counted: 0, haiku: 0, sonnet: 0, other: 0, tin: 0, tout: 0, cost: 0, days: [] }); return per.get(id); };
      for (const r of c.data || []) { const x = get(r.owner); const k = short(r.model).toLowerCase(); x[k in x ? k : 'other'] += r.requests; x.req += r.requests; x.tin += +r.input_tokens + +r.cache_read + +r.cache_write; x.tout += +r.output_tokens; x.cost += +r.cost_usd; x.days.push(r); }
      for (const r of u.data || []) get(r.owner).counted += r.count;
      const rows = [...per.values()].sort((a, b) => b.cost - a.cost || b.counted - a.counted);
      status.textContent = '';
      if (!rows.length) { out.append(h('p', { class: 'w-lead' }, 'Aucune demande à l\'IA ce mois-ci.')); return; }
      const tot = rows.reduce((t, x) => ({ req: t.req + x.req, counted: t.counted + x.counted, cost: t.cost + x.cost, tin: t.tin + x.tin, tout: t.tout + x.tout }), { req: 0, counted: 0, cost: 0, tin: 0, tout: 0 });
      const isNow = sel.value === ym(now);
      const daysIn = new Date(y, m, 0).getDate(), elapsed = isNow ? now.getDate() : daysIn;
      const proj = isNow && tot.cost ? tot.cost / elapsed * daysIn : null;
      out.append(h('div', { class: 'w-kpis' },
        h('div', null, h('span', null, 'Coût du mois'), h('b', null, eur(tot.cost)), h('small', null, usd(tot.cost))),
        proj != null ? h('div', null, h('span', null, 'Projection fin de mois'), h('b', null, eur(proj)), h('small', null, 'au rythme actuel')) : null,
        h('div', null, h('span', null, 'Coût moyen par personne'), h('b', null, eur(tot.cost / rows.length)), h('small', null, rows.length + ' personne' + (rows.length > 1 ? 's' : ''))),
        h('div', null, h('span', null, 'Coût moyen d\'une demande'), h('b', null, tot.req ? eur(tot.cost / tot.req) : '–'), h('small', null, tot.req + ' demandes suivies'))));
      const table = h('table', { class: 'w-table w-conso' }, h('thead', null, h('tr', null, ...['Personne', 'Demandes', 'Haiku', 'Sonnet', 'Tokens entrée / sortie', 'Coût', ''].map(t => h('th', null, t)))));
      const tb = h('tbody'); table.append(tb);
      for (const x of rows) {
        const pr = who.get(x.id) || {};
        const det = h('tr', { class: 'w-conso-det', hidden: true }, h('td', { colspan: '7' }, h('table', { class: 'w-table' }, h('tbody', null,
          ...x.days.sort((a, b) => a.day < b.day ? 1 : -1).map(r => h('tr', null, h('td', null, new Date(r.day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })), h('td', null, short(r.model)), h('td', null, r.requests + ' dem.'), h('td', null, tok(+r.input_tokens + +r.cache_read + +r.cache_write) + ' / ' + tok(+r.output_tokens)), h('td', null, eur(+r.cost_usd))))))));
        const more = h('button', { class: 'w-switch', type: 'button', hidden: !x.days.length }, 'par jour');
        more.addEventListener('click', () => { det.hidden = !det.hidden; more.textContent = det.hidden ? 'par jour' : 'masquer'; });
        tb.append(h('tr', null, h('td', null, h('b', null, pr.display_name || pr.login || '?'), h('div', { class: 'w-sub' }, pr.login || '')),
          h('td', null, String(Math.max(x.req, x.counted))), h('td', null, String(x.haiku)), h('td', null, String(x.sonnet)),
          h('td', null, x.req ? tok(x.tin) + ' / ' + tok(x.tout) : '–'), h('td', null, h('b', null, eur(x.cost)), h('div', { class: 'w-sub' }, usd(x.cost))), h('td', null, more)), det);
      }
      tb.append(h('tr', { class: 'w-conso-tot' }, h('td', null, h('b', null, 'Total')), h('td', null, String(Math.max(tot.req, tot.counted))), h('td'), h('td'), h('td', null, tok(tot.tin) + ' / ' + tok(tot.tout)), h('td', null, h('b', null, eur(tot.cost)), h('div', { class: 'w-sub' }, usd(tot.cost))), h('td')));
      out.append(h('div', { class: 'w-scroll' }, table));
      if (tot.counted > tot.req) out.append(h('p', { class: 'w-note' }, (tot.counted - tot.req) + ' demande(s) de ce mois datent d\'avant le suivi des tokens : elles sont comptées dans « Demandes » mais pas dans le coût.'));
    } catch (e) { status.textContent = 'Échec : ' + (e.message || e); }
  };
  sel.addEventListener('change', load);
  rateIn.addEventListener('change', () => { rate = +rateIn.value || 0.86; try { localStorage.setItem(RATE_KEY, String(rate)); } catch (e) { /* */ } load(); });
  body.append(h('section', { class: 'w-sec' }, h('h2', { class: 'w-h' }, 'Consommation de l\'IA'),
    h('p', { class: 'w-lead' }, 'Ce que chaque compte a consommé en crédits Claude, calculé à partir des tokens de chaque demande et des tarifs publics (Haiku 5.5 et Sonnet 5.5). La console Claude (platform.claude.com/usage) reste la référence pour ta facture.'),
    h('div', { class: 'w-row' }, sel, h('label', { class: 'w-note', style: 'margin:0' }, '1 $ = ', rateIn, ' €')), status, out));
  load();
}
function accountsTab(body) {
  const status = h('div', { class: 'w-status', role: 'status' });
  const table = h('table', { class: 'w-table' });
  const listBox = h('div', { class: 'w-scroll' }, table);
  const login = h('input', { class: 'w-input', placeholder: 'identifiant (ex. jean.dupont)', autocapitalize: 'off', spellcheck: 'false' });
  const name = h('input', { class: 'w-input', placeholder: 'Prénom Nom' });
  const pw = h('input', { class: 'w-input', value: genPw(), 'aria-label': 'Mot de passe' });
  name.addEventListener('input', () => { if (!login.dataset.touched) login.value = slug(name.value); });
  login.addEventListener('input', () => { login.dataset.touched = '1'; });
  const add = h('button', { class: 'btn primary', type: 'button' }, 'Créer le compte');
  const made = h('div', { class: 'w-made' });
  const remember = (l, p, n) => { made.prepend(h('div', { class: 'w-cred' }, h('span', null, n ? n + ' — ' : ''), h('code', null, l), ' / ', h('code', null, p),
    h('button', { class: 'btn sm', type: 'button', onclick: e => { navigator.clipboard.writeText('Site : ' + location.href.split('#')[0] + '\nIdentifiant : ' + l + '\nMot de passe : ' + p + '\n(change-le dans Guide → Réglages après ta première connexion)'); e.currentTarget.textContent = 'Copié'; } }, 'Copier le message'))); };
  add.addEventListener('click', async () => {
    const l = slug(login.value).replace(/\.+/g, '.'); if (!l) { status.textContent = 'Indique un identifiant.'; return; }
    add.disabled = true; status.textContent = 'Création…';
    try { await adminCall({ action: 'create', login: l, email: emailOf(l), password: pw.value, name: name.value.trim() }); remember(l, pw.value, name.value.trim()); status.textContent = 'Compte ' + l + ' créé. Donne-lui son identifiant et son mot de passe.'; login.value = name.value = ''; delete login.dataset.touched; pw.value = genPw(); load(); }
    catch (e) { status.textContent = 'Échec : ' + e.message; }
    add.disabled = false;
  });
  // création en série
  const bulk = h('textarea', { class: 'w-input w-bulk', rows: 4, placeholder: 'Un nom par ligne :\nJean Dupont\nLéa Martin' });
  const bulkBtn = h('button', { class: 'btn', type: 'button' }, 'Créer tous ces comptes');
  bulkBtn.addEventListener('click', async () => {
    const names = bulk.value.split('\n').map(s => s.trim()).filter(Boolean); if (!names.length) return;
    bulkBtn.disabled = true; const lines = ['Nom;Identifiant;Mot de passe'];
    for (const [i, n] of names.entries()) {
      const l = slug(n), p = genPw(); status.textContent = 'Création ' + (i + 1) + '/' + names.length + '…';
      try { await adminCall({ action: 'create', login: l, email: emailOf(l), password: p, name: n }); remember(l, p, n); lines.push(n + ';' + l + ';' + p); }
      catch (e) { lines.push(n + ';' + l + ';ÉCHEC : ' + e.message); }
    }
    saveFile('comptes-atelier-but1.csv', '﻿' + lines.join('\r\n'), 'text/csv');
    status.textContent = 'Terminé. La liste (avec les mots de passe) a été téléchargée : garde-la pour toi.'; bulk.value = ''; bulkBtn.disabled = false; load();
  });
  body.append(
    h('section', { class: 'w-sec' }, h('h2', { class: 'w-h' }, 'Nouveau compte'),
      h('p', { class: 'w-lead' }, 'La personne se connecte avec cet identifiant et ce mot de passe, puis peut le changer dans Guide → Réglages.'),
      h('div', { class: 'w-row' }, name, login, pw, add), made,
      h('details', { class: 'w-det' }, h('summary', null, 'Créer plusieurs comptes d\'un coup'), bulk, h('div', { class: 'w-row' }, bulkBtn))),
    status,
    h('section', { class: 'w-sec' }, h('h2', { class: 'w-h' }, 'Comptes existants'), listBox));
  async function load() {
    table.innerHTML = '<tr><td class="muted">Chargement…</td></tr>';
    try {
      const { users } = await adminCall({ action: 'list' });
      table.textContent = '';
      table.append(h('tr', null, h('th', null, 'Identifiant'), h('th', null, 'Nom'), h('th', null, 'EDT'), h('th', null, 'Dernière connexion'), h('th', null, '')));
      for (const u of users) {
        const reset = h('button', { class: 'btn sm', type: 'button' }, 'Nouveau mot de passe');
        reset.addEventListener('click', async () => { const p = genPw(); if (!confirmInline(reset, 'Remplacer son mot de passe ?')) return; try { await adminCall({ action: 'password', id: u.id, password: p }); remember(u.login, p, u.name); status.textContent = 'Nouveau mot de passe pour ' + u.login + ' : ' + p; } catch (e) { status.textContent = 'Échec : ' + e.message; } });
        const del = h('button', { class: 'btn sm danger', type: 'button' }, 'Supprimer');
        del.addEventListener('click', async () => { if (!confirmInline(del, 'Supprimer ' + u.login + ' et tous ses fichiers ?')) return; try { await adminCall({ action: 'delete', id: u.id }); load(); } catch (e) { status.textContent = 'Échec : ' + e.message; } });
        table.append(h('tr', null, h('td', null, h('code', null, u.login), u.admin ? h('span', { class: 'w-tag' }, 'admin') : null), h('td', null, u.name || ''), h('td', null, u.edt ? '✓' : '—'),
          h('td', { class: 'muted' }, u.lastSeen ? new Date(u.lastSeen).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais'),
          h('td', { class: 'w-actions' }, reset, u.admin ? null : del)));
      }
    } catch (e) { table.innerHTML = ''; status.textContent = 'Impossible de lire les comptes : ' + e.message; }
  }
  load();
}
// confirmation en deux clics (pas de boîte de dialogue du navigateur)
function confirmInline(btn, msg) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
  btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.textContent = msg + ' Re-clique';
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}
async function sha(s) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(s))), b => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
function coursTab(body) {
  const status = h('div', { class: 'w-status', role: 'status' });
  const stats = h('p', { class: 'w-lead' });
  const zip = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
  const dir = h('input', { type: 'file', hidden: true, webkitdirectory: true, multiple: true });
  const skip = h('input', { type: 'checkbox', checked: true, id: 'w-skip' });
  const zb = h('button', { class: 'btn primary', type: 'button', onclick: () => zip.click() }, 'Importer un .zip');
  const db = h('button', { class: 'btn', type: 'button', onclick: () => dir.click() }, 'Importer un dossier');
  const refresh = async () => { try { const all = await rows(true); const shared = [...all.values()].filter(r => r.owner == null && r.mime !== FOLDER); stats.textContent = shared.length + ' fichiers dans la bibliothèque commune, visibles par tous les comptes.'; } catch (e) { stats.textContent = ''; } };
  const run = async files => {
    zb.disabled = db.disabled = true;
    try { const n = await importCourses(files, skip.checked, t => { status.textContent = t; }); status.textContent = n.added + ' fichier(s) importé(s)' + (n.skipped ? ', ' + n.skipped + ' ignoré(s) (code, corrections, réponses…)' : '') + '. Les autres comptes les verront à leur prochaine synchronisation.'; await refresh(); if (W.resync) W.resync(); }
    catch (e) { status.textContent = 'Échec : ' + (e.message || e); }
    zb.disabled = db.disabled = false;
  };
  zip.addEventListener('change', async () => { const f = zip.files[0]; if (!f) return; status.textContent = 'Lecture du .zip…'; try { const ents = await zipRead(await f.arrayBuffer()); run(ents.map(e => ({ path: e.name, read: e.read }))); } catch (e) { status.textContent = 'Échec : ' + e.message; } zip.value = ''; });
  dir.addEventListener('change', () => { const fs = [...dir.files]; dir.value = ''; run(fs.map(f => ({ path: f.webkitRelativePath || f.name, read: async () => new Uint8Array(await f.arrayBuffer()) }))); });
  body.append(h('section', { class: 'w-sec' }, h('h2', { class: 'w-h' }, 'Bibliothèque de cours commune'),
    h('p', { class: 'w-lead' }, 'Ce que tu importes ici est visible par tous les comptes (en lecture). Chacun garde ses propres fichiers à part : son code, ses réponses et ses modifications ne sont visibles que par lui.'),
    h('p', { class: 'w-lead' }, 'Importe ton dossier « BUT 1 » tel quel (ou un .zip). Réimporter met à jour les fichiers existants sans créer de doublons.'),
    stats, h('label', { class: 'w-check', for: 'w-skip' }, skip, ' Seulement les sujets et les cours (PDF, documents, images, tables SQL) : pas ton code, tes réponses, tes corrections ni tes brouillons (recommandé)'),
    h('div', { class: 'w-row' }, zb, db, zip, dir)), status);
  refresh();
  if (ONLINE) body.prepend(driveSyncSection(refresh));
}

/* ---------- synchro automatique avec Google Drive (fonction drive-sync) ---------- */
async function syncCall(body) {
  const { data, error } = await sb.functions.invoke('drive-sync', { body });
  if (error) { let m = error.message; try { const j = await error.context.json(); m = j.error || m; } catch (e) { /* */ } throw new Error(m); }
  if (data && data.error) throw new Error(data.error);
  return data;
}
function driveSyncSection(refreshStats) {
  const sec = h('section', { class: 'w-sec' });
  const status = h('div', { class: 'w-status', role: 'status' });
  const when = d => d ? new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';
  const sum = r => !r ? '' : r.error ? 'Erreur : ' + r.error
    : [r.added && r.added + ' ajouté(s)', r.updated && r.updated + ' mis à jour', r.removed && r.removed + ' retiré(s)', (r.unchanged || 0) + ' déjà à jour', r.mine && r.mine + ' dans ton espace seulement'].filter(Boolean).join(', ')
      + (r.partial ? ' (pas fini : la suite au prochain passage)' : '') + (r.errors && r.errors.length ? '. Problèmes : ' + r.errors.slice(0, 3).join(' ; ') : '');
  const draw = s => {
    sec.textContent = '';
    const ok = s.robot && s.lastOk && !(s.last && s.last.error);
    sec.append(h('h2', { class: 'w-h' }, 'Synchro automatique avec Google Drive'));
    if (!s.robot) {
      sec.append(h('p', { class: 'w-lead' }, s.robotBad ? 'La clé du robot enregistrée dans Supabase n\'est pas valide : recolle tout le contenu du fichier .json dans le secret GDRIVE_SA_JSON.'
        : 'Pas encore activée : il manque le compte robot Google (secret GDRIVE_SA_JSON dans Supabase). Une fois en place, les cours de ton Drive arrivent ici tout seuls, chaque heure.'));
    } else {
      sec.append(h('p', { class: 'w-lead' }, 'Le site copie ton dossier ', h('b', null, s.folderName || 'Drive'), ' toutes les heures (seulement les fichiers nouveaux ou modifiés ; les Google Docs arrivent en PDF). Les sujets et les cours vont dans la bibliothèque commune ; tes réponses, ton code et les corrigés arrivent seulement dans ton espace : les autres comptes ne les voient pas.'),
        h('p', { class: 'w-note' }, 'Le dossier doit être partagé (lecteur) avec le robot : ', h('code', null, s.robot)),
        h('p', { class: 'w-note' }, 'Dernier passage : ' + when(s.lastRun) + (s.last ? ' · ' + sum(s.last) : '')));
    }
    const run = h('button', { class: 'btn primary', type: 'button', disabled: !s.robot }, 'Synchroniser maintenant');
    run.addEventListener('click', async () => {
      run.disabled = true; let total = { added: 0, updated: 0, removed: 0 };
      try {
        for (let i = 1; i <= 8; i++) {
          status.textContent = i === 1 ? 'Lecture du Drive…' : 'On continue (' + i + ')…';
          const r = await syncCall({ action: 'run' });
          total.added += r.added; total.updated += r.updated; total.removed += r.removed;
          if (!r.partial || (r.errors && r.errors.length && !r.added && !r.updated)) { status.textContent = 'C\'est fait : ' + sum(Object.assign({}, r, total)); break; }
        }
        cache = null; if (W.resync) W.resync(); refreshStats();
      } catch (e) { status.textContent = 'Échec : ' + e.message; }
      run.disabled = false; load(true);
    });
    const auto = h('input', { type: 'checkbox', id: 'w-auto', checked: !!s.auto });
    auto.addEventListener('change', async () => { try { await syncCall({ action: 'auto', on: auto.checked }); status.textContent = auto.checked ? 'Synchro automatique activée.' : 'Synchro automatique en pause.'; } catch (e) { status.textContent = 'Échec : ' + e.message; } });
    const link = h('input', { class: 'w-input', type: 'url', placeholder: 'Lien du dossier Google Drive (https://drive.google.com/drive/folders/…)' });
    const setDir = h('button', { class: 'btn', type: 'button' }, 'Changer de dossier');
    setDir.addEventListener('click', async () => { try { await syncCall({ action: 'folder', folder: link.value }); link.value = ''; status.textContent = 'Dossier enregistré. Clique sur « Synchroniser maintenant ».'; load(true); } catch (e) { status.textContent = 'Échec : ' + e.message; } });
    sec.append(h('div', { class: 'w-row' }, run), h('label', { class: 'w-check', for: 'w-auto' }, auto, ' Synchroniser automatiquement toutes les heures'));
    if (ok && s.orphans) {
      const tidy = h('button', { class: 'btn', type: 'button' }, 'Ranger');
      tidy.addEventListener('click', async () => { tidy.disabled = true; try { const r = await syncCall({ action: 'cleanup' }); status.textContent = r.removed + ' ancien(s) fichier(s) retiré(s).'; cache = null; if (W.resync) W.resync(); refreshStats(); load(true); } catch (e) { status.textContent = 'Échec : ' + e.message; tidy.disabled = false; } });
      sec.append(h('p', { class: 'w-note' }, s.orphans + ' fichier(s) de la bibliothèque ne sont pas dans ton Drive (anciens imports à la main, par exemple ' + s.orphanNames.slice(0, 3).join(', ') + '). '), h('div', { class: 'w-row' }, tidy));
    }
    sec.append(h('details', { class: 'w-note' }, h('summary', null, 'Changer de dossier Drive'), h('div', { class: 'w-row' }, link, setDir)), status);
  };
  const load = async keep => { const msg = status.textContent; try { draw(await syncCall({ action: 'status' })); if (keep) status.textContent = msg; } catch (e) { sec.textContent = ''; sec.append(h('h2', { class: 'w-h' }, 'Synchro automatique avec Google Drive'), h('p', { class: 'w-note' }, 'Indisponible : ' + e.message)); } };
  sec.append(h('h2', { class: 'w-h' }, 'Synchro automatique avec Google Drive'), h('p', { class: 'w-note' }, 'Chargement…'));
  load();
  return sec;
}
async function importCourses(files, skipPrivate, say) {
  const prevAdmin = W.adminMode; W.adminMode = true;
  try {
    // chemins : on enlève le dossier de tête (« BUT 1/ ») s'il est commun à tous
    const items = files.filter(f => !/(^|\/)(\.|__MACOSX|Thumbs\.db|desktop\.ini)/i.test(f.path)).map(f => Object.assign(f, { parts: f.path.replace(/\\/g, '/').split('/').filter(Boolean) }));
    if (!items.length) throw new Error('aucun fichier trouvé');
    const head = items[0].parts[0];
    if (items.every(f => f.parts.length > 1 && f.parts[0] === head)) items.forEach(f => f.parts.shift());
    const all = await rows(true);
    const folderId = new Map([['', ROOT_ID]]);
    const ensureFolder = async segs => {
      const key = segs.join('/'); if (folderId.has(key)) return folderId.get(key);
      const parent = await ensureFolder(segs.slice(0, -1));
      const id = 'c' + await sha('dir:' + key);
      if (!all.has(id)) { const row = { id, owner: null, parent, name: segs[segs.length - 1], mime: FOLDER, modified: new Date().toISOString() }; await B().insert(row); all.set(id, row); }
      folderId.set(key, id); return id;
    };
    let added = 0, skipped = 0, i = 0;
    for (const f of items) {
      i++; const name = f.parts[f.parts.length - 1];
      if (skipPrivate && !/contenu des tables/i.test(name) && (!SHARE_OK.test(name) || SITE_DOC_RE.test(name) || PRIVATE_NAME.test(name) || f.parts.some(p => PRIVATE_NAME.test(p)))) { skipped++; continue; }
      say('Import ' + i + '/' + items.length + ' : ' + name);
      const parent = await ensureFolder(f.parts.slice(0, -1));
      const id = 'c' + await sha('file:' + f.parts.join('/'));
      const bytes = await f.read(); const mime = mimeOf(name);
      const row = { id, owner: null, parent, name, mime, size: bytes.length, modified: new Date().toISOString(), content: null, storage_path: null };
      if (TEXT_EXT.test(name) && bytes.length < 2500000) row.content = dec.decode(bytes);
      else { row.storage_path = 'cours/' + id; await B().putBlob(row.storage_path, bytes, mime); }
      if (all.has(id)) await B().update(id, row); else await B().insert(row);
      all.set(id, row); added++;
    }
    cache = null;
    return { added, skipped };
  } finally { W.adminMode = prevAdmin; }
}
W.importCourses = importCourses;

/* ---------- les liens « Drive » du site deviennent des téléchargements ---------- */
async function downloadNode(id) {
  const all = await rows(); const r = all.get(id); if (!r) { alertBox('Fichier introuvable'); return; }
  if (r.mime !== FOLDER) { try { saveFile(r.name, await bytesOf(r), r.mime); } catch (e) { alertBox('Téléchargement impossible : ' + (e.message || e)); } return; }
  alertBox('Préparation du .zip…');
  const entries = []; const walk = async (x, pre) => { for (const k of [...all.values()].filter(y => y.parent === x.id)) { if (k.mime === FOLDER) await walk(k, pre + k.name + '/'); else { try { entries.push([pre + k.name, await bytesOf(k)]); } catch (e) {} } } };
  await walk(r, r.name + '/');
  if (!entries.length) { alertBox('Dossier vide'); return; }
  saveFile(r.name + '.zip', zipWrite(entries));
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href*="drive.google.com"]'); if (!a) return;
  e.preventDefault();
  const m = /\/(?:file\/d|folders)\/([^/?#]+)/.exec(a.getAttribute('href')) || /[?&]id=([^&#]+)/.exec(a.getAttribute('href'));
  if (m) downloadNode(decodeURIComponent(m[1]));
}, true);

/* =====================================================================
   Connexion
   ===================================================================== */
W.logout = async () => { try { await sb.auth.signOut(); } catch (e) {} try { sessionStorage.removeItem('atelier-but1-in'); } catch (e) {} location.hash = ''; location.reload(); };
// dernier compte utilisé sur cet appareil (identifiant + nom affiché, jamais le mot de passe)
const LAST_KEY = 'atelier-but1-last';
const lastAccount = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY)); } catch (e) { return null; } };
const rememberAccount = p => { try { if (p && p.login) localStorage.setItem(LAST_KEY, JSON.stringify({ login: p.login, name: p.display_name || p.login })); } catch (e) {} };
const forgetAccount = () => { try { localStorage.removeItem(LAST_KEY); } catch (e) {} };
const initials = n => String(n || '?').trim().split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?';

/* vidéo de présentation : à côté du formulaire sur grand écran, sur demande sur téléphone */
const PROMO = CFG.promoVideo === false ? null : { src: CFG.promoVideo || 'media/pub.mp4?v=6', poster: CFG.promoPoster || 'media/pub-poster.jpg' };
const wide = () => matchMedia('(min-width: 1000px)').matches;
// MP4 (H.264) pour la plupart des navigateurs, WebM en secours
const addSources = v => { v.append(h('source', { src: PROMO.src, type: 'video/mp4' }), h('source', { src: PROMO.src.replace(/\.mp4(\?|$)/, '.webm$1'), type: 'video/webm' })); };
function promoPanel() {
  if (!PROMO || !wide()) return null;
  const v = h('video', { class: 'w-pv', muted: true, autoplay: true, loop: true, playsinline: true, preload: 'auto', poster: PROMO.poster, 'aria-label': 'Vidéo de présentation de l\'Atelier' });
  v.muted = true; addSources(v);
  const box = h('div', { class: 'w-promo' });
  const snd = h('button', { class: 'w-snd', type: 'button', 'aria-label': 'Activer le son', title: 'Son' }, '🔇');
  snd.addEventListener('click', () => { v.muted = !v.muted; snd.textContent = v.muted ? '🔇' : '🔊'; snd.setAttribute('aria-label', v.muted ? 'Activer le son' : 'Couper le son'); if (v.paused) v.play().catch(() => {}); });
  v.lastElementChild.addEventListener('error', () => box.remove());
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.removeAttribute('autoplay'); v.controls = true; }
  box.append(h('div', { class: 'w-pframe' }, v, snd), h('p', { class: 'w-pcap' }, h('b', null, 'L\'Atelier en 43 secondes'), ' · cours, C++, SQL, web, emploi du temps et tuteur IA au même endroit'));
  return box;
}
function promoLink() {
  if (!PROMO || wide()) return null;
  const a = h('button', { class: 'w-plink', type: 'button' }, '▶ Voir la présentation (43 s)');
  a.addEventListener('click', () => {
    const v = h('video', { class: 'w-pv', controls: true, autoplay: true, playsinline: true, poster: PROMO.poster }); addSources(v);
    const ov = h('div', { class: 'w-ov w-pov', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vidéo de présentation' });
    const close = () => { v.pause(); ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.append(h('div', { class: 'w-pframe' }, v), h('button', { class: 'btn w-pclose', type: 'button', onclick: close }, 'Fermer'));
    document.body.append(ov);
  });
  return a;
}

/* écran de connexion : 3 cas
   - déjà connecté sur cet appareil  → « Se connecter » en un clic (+ « Changer de compte »)
   - compte connu mais déconnecté    → seulement le mot de passe (+ « Changer de compte »)
   - inconnu                         → identifiant + mot de passe */
function loginScreen(msg, mode) {
  document.querySelectorAll('.w-login').forEach(x => x.remove());
  const ov = h('div', { class: 'w-login' });
  const last = lastAccount();
  const known = mode === 'session' || (mode !== 'new' && last && last.login);
  const status = h('div', { class: 'w-status', role: 'alert', text: msg || '' });
  const card = h('div', { class: 'w-lcard' },
    h('div', { class: 'w-brand' }, h('div', { class: 'w-ref', text: 'BUT Informatique · 1re année' }), h('div', { class: 'w-name', html: esc(CFG.siteName).replace(/BUT 1$/, '<span>BUT 1</span>') })));
  const switchLink = h('button', { class: 'w-switch', type: 'button' }, 'Changer de compte');
  switchLink.addEventListener('click', async () => {
    switchLink.disabled = true;
    if (mode === 'session') { try { await sb.auth.signOut(); } catch (e) {} }
    forgetAccount(); try { sessionStorage.removeItem('atelier-but1-in'); } catch (e) {}
    loginScreen('', 'new');
  });
  const who = (name, sub) => h('div', { class: 'w-who' }, h('span', { class: 'w-av', 'aria-hidden': 'true' }, initials(name)), h('div', null, h('b', null, name), h('div', { class: 'w-sub' }, sub)));

  if (mode === 'session') {
    const go = h('button', { class: 'btn primary w-go', type: 'button' }, 'Se connecter');
    go.addEventListener('click', () => { try { sessionStorage.setItem('atelier-but1-in', '1'); } catch (e) {} ov.remove(); document.documentElement.classList.remove('w-out'); start(true); });
    card.append(h('p', { class: 'w-lead' }, 'Bon retour ! Tu es déjà connecté sur cet appareil.'),
      who(last && last.name || 'Ton compte', last && last.login ? 'identifiant ' + last.login : ''), go, h('div', { class: 'w-alt' }, switchLink), status);
    setTimeout(() => go.focus(), 50);
  } else {
    const id = h('input', { class: 'w-input', id: 'w-id', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
    const pw = h('input', { class: 'w-input', id: 'w-pw', type: 'password', autocomplete: 'current-password', required: true });
    const show = h('button', { class: 'w-eye', type: 'button', 'aria-label': 'Afficher le mot de passe', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; } }, '👁');
    const go = h('button', { class: 'btn primary w-go', type: 'submit' }, 'Se connecter');
    if (known) id.value = last.login;
    const form = h('form', { class: 'w-form', novalidate: true },
      known ? who(last.name, 'identifiant ' + last.login) : null,
      known ? h('input', { type: 'hidden', autocomplete: 'username', value: last.login }) : null,
      known ? null : h('label', { for: 'w-id' }, 'Identifiant'), known ? null : id,
      h('label', { for: 'w-pw' }, 'Mot de passe'), h('div', { class: 'w-pwrow' }, pw, show), go, status);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const raw = id.value.trim().toLowerCase(); if (!raw || !pw.value) { status.textContent = known ? 'Entre ton mot de passe.' : 'Remplis les deux champs.'; return; }
      go.disabled = true; status.textContent = 'Connexion…';
      const { error } = await sb.auth.signInWithPassword({ email: emailOf(raw), password: pw.value });
      go.disabled = false;
      if (error) { status.textContent = /invalid/i.test(error.message) ? (known ? 'Mot de passe incorrect.' : 'Identifiant ou mot de passe incorrect.') : /fetch|network/i.test(error.message) ? 'Pas de connexion au serveur. Vérifie ton internet.' : error.message; pw.select(); return; }
      try { sessionStorage.setItem('atelier-but1-in', '1'); } catch (x) {}
      ov.remove(); start(true);
    });
    card.append(...[h('p', { class: 'w-lead' }, known ? 'Bon retour ! Entre ton mot de passe pour retrouver ton espace.' : 'Tes cours, ton code, ton emploi du temps. Connecte-toi pour retrouver ton espace depuis n\'importe quel appareil.'),
      form, known ? h('div', { class: 'w-alt' }, switchLink) : null].filter(Boolean));
    setTimeout(() => (known ? pw : id).focus(), 50);
  }
  card.append(...[h('p', { class: 'w-foot' }, 'Pas encore de compte ? Demande tes identifiants', CFG.adminContact ? h('span', null, ' à ', h('b', null, CFG.adminContact)) : ' à la personne qui t\'a envoyé ce lien', '.'), promoLink()].filter(Boolean));
  const promo = promoPanel();
  ov.append(h('div', { class: 'w-lwrap' + (promo ? ' w-with-promo' : '') }, promo, card));
  document.body.append(ov);
}

/* =====================================================================
   Démarrage
   ===================================================================== */
let booted = false;
const stopPromo = () => document.querySelectorAll('.w-pov, .w-promo').forEach(x => { x.querySelectorAll('video').forEach(v => v.pause()); if (x.classList.contains('w-pov')) x.remove(); });
function boot() {
  if (booted) return; booted = true;
  stopPromo();
  const src = document.getElementById('atelier-main');
  const s = document.createElement('script'); s.textContent = src.textContent; document.body.append(s);
  document.documentElement.classList.add('w-ready');
  // bandeau du haut de la barre latérale
  const ref = document.querySelector('.brand .ref');
  if (ref && W.profile) ref.textContent = (W.profile.display_name || W.profile.login || '') + (W.isAdmin ? ' · admin' : '');
  else if (ref && !ONLINE) ref.textContent = 'Mode local · ce navigateur';
}
async function start(confirmed) {
  if (!ONLINE) { W.user = { id: 'local' }; W.ns = 'but1:local:'; boot(); return; }
  const { data } = await sb.auth.getSession();
  const s = data.session;
  if (!s) { document.documentElement.classList.add('w-out'); loginScreen(); return; }
  // déjà connecté : à l'ouverture du site on propose « Se connecter » (ou « Changer de compte ») ;
  // un simple rechargement dans le même onglet entre directement
  let inTab = false; try { inTab = sessionStorage.getItem('atelier-but1-in') === '1'; } catch (e) {}
  if (!confirmed && !inTab) { document.documentElement.classList.add('w-out'); loginScreen('', 'session'); return; }
  document.documentElement.classList.remove('w-out');
  W.user = s.user; W.ns = 'but1:' + s.user.id + ':';
  // profil : en ligne si possible, sinon la dernière copie (hors connexion)
  const key = W.ns + 'profile';
  try {
    const { data: p, error } = await sb.from('profiles').select('*').eq('id', s.user.id).single();
    if (error) throw error; W.profile = p; try { localStorage.setItem(key, JSON.stringify(p)); } catch (e) {}
  } catch (e) { try { W.profile = JSON.parse(localStorage.getItem(key)) || { login: s.user.email.split('@')[0] }; } catch (x) { W.profile = { login: '' }; } }
  W.isAdmin = !!W.profile.is_admin;
  rememberAccount(W.profile);
  boot();
}
function init() {
  if (ONLINE) {
    if (!window.supabase) { document.body.append(h('p', { class: 'w-fatal', text: 'Le site n\'a pas pu se charger. Recharge la page.' })); return; }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'atelier-but1-auth' } });
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && booted) location.reload(); });
    W.sb = sb;
  }
  start().catch(e => { console.error(e); loginScreen('Erreur au démarrage : ' + (e.message || e)); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
