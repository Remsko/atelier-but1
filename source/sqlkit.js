/* SQLKIT : tables tirées des fichiers du Drive (sorties « +----+ » copiées depuis C5 ou scripts .sql),
   exécution des requêtes avec alasql, affichage au format MySQL et annotations de preuve. */
var SQLKIT = (function () {
  'use strict';
  const SEP = /^\s*\+(?:-+\+)+\s*$/;
  const isSep = l => SEP.test(l);
  const splitRow = l => { const t = l.trim(); if (!t.startsWith('|')) return null; return t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map(c => c.trim()); };

  function nameBefore(lines, i) {
    for (let j = i - 1, seen = 0; j >= 0 && seen < 4; j--) {
      const l = lines[j].trim(); if (!l) continue; seen++;
      let m = /^(?:mysql>\s*)?select\s+\*\s+from\s+[`"[]?([A-Za-z_][\w]*)[`"\]]?\s*;?\s*$/i.exec(l);
      if (m) return m[1];
      if (/\b(select|where|from|join)\b/i.test(l)) return null; // résultat d'une requête, pas une table
      m = /^(?:#+\s*)?(?:table|contenu de la table|relation)\s*:?\s*[`"«]?\s*([A-Za-z_]\w*)/i.exec(l);
      if (m) return m[1];
      m = /^[#=*\-\s]*[`"«]?([A-Za-z_]\w*)[`"»]?\s*[:=*\-#]*\s*(?:\(\d+\s*lignes?\))?\s*$/.exec(l);
      if (m && !/^(rows?|empty|set|résultat|resultat)$/i.test(m[1])) return m[1];
      if (/rows? in set|empty set/i.test(l)) return null;
    }
    return null;
  }
  const conv = v => {
    if (v === 'NULL' || v === 'null') return null;
    if (/^-?\d+$/.test(v) && v.length < 16) return parseInt(v, 10);
    if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
    return v;
  };
  /* tableaux ASCII nommés d'un texte */
  function parseAscii(text, keepUnnamed) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isSep(lines[i]) || i + 2 >= lines.length) continue;
      const head = splitRow(lines[i + 1]);
      if (!head || !isSep(lines[i + 2])) continue;
      const name = nameBefore(lines, i);
      const rows = []; let j = i + 3;
      for (; j < lines.length; j++) {
        if (isSep(lines[j])) break;
        const r = splitRow(lines[j]); if (!r) break;
        rows.push(r.slice(0, head.length).map(conv));
      }
      i = j;
      if (name || keepUnnamed) out.push({ name, cols: head, rows });
    }
    return out;
  }
  /* découpe d'un script SQL en instructions */
  function statements(src) {
    const out = []; let cur = '', q = null;
    const s = String(src || '').replace(/\r/g, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { cur += c; if (c === q && s[i - 1] !== '\\') q = null; continue; }
      if (c === '-' && s[i + 1] === '-') { while (i < s.length && s[i] !== '\n') i++; cur += '\n'; continue; }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; cur += '\n'; continue; }
      if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 1; continue; }
      if (c === '\'' || c === '"' || c === '`') { q = c; cur += c; continue; }
      if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  const typeOf = vals => vals.every(v => v == null || Number.isInteger(v)) ? 'INT' : vals.every(v => v == null || typeof v === 'number') ? 'NUMBER' : 'STRING';

  /* sources : [{name, text}] du plus proche au plus lointain ; les premières tables trouvées l'emportent */
  function collect(sources) {
    const tables = new Map(), scripts = [], notes = [];
    for (const src of sources) {
      if (/\.sql$/i.test(src.name) || (!/^\s*\+-/m.test(src.text) && /\b(create\s+table|insert\s+into)\b/i.test(src.text))) scripts.push(src);
      else for (const t of parseAscii(src.text)) {
        const key = t.name.toLowerCase();
        if (!tables.has(key)) tables.set(key, Object.assign({ from: src.name }, t));
      }
    }
    return { tables, scripts, notes };
  }
  function build(alasql, col) {
    const db = new alasql.Database();
    const errors = [];
    const has = n => !!db.tables[n];
    // scripts SQL (les plus lointains d'abord, les tables ASCII plus proches remplacent ensuite)
    for (const sc of col.scripts.slice().reverse()) {
      for (let st of statements(sc.text)) {
        st = st.replace(/\)\s*(ENGINE|DEFAULT\s+CHARSET|CHARSET|COLLATE|AUTO_INCREMENT)\s*=[\s\S]*$/i, ')').replace(/\bAUTO_INCREMENT\b/gi, '').replace(/\bUNSIGNED\b/gi, '');
        if (/^(set|use|lock|unlock|start|commit|begin|create\s+database|drop\s+database)\b/i.test(st)) continue;
        try { db.exec(st); }
        catch (e) {
          if (/^create\s+table/i.test(st)) {
            const simple = st.replace(/,\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|UNIQUE\s+KEY|KEY|INDEX)\b[^,]*?(\([^)]*\))?(\s*REFERENCES\s+\w+\s*\([^)]*\))?(\s*ON\s+(DELETE|UPDATE)\s+\w+(\s+\w+)?)*/gi, '').replace(/\bREFERENCES\s+\w+\s*\([^)]*\)/gi, '');
            try { db.exec(simple); continue; } catch (e2) { }
          }
          errors.push(sc.name + ' : ' + st.slice(0, 60).replace(/\s+/g, ' ') + '… → ' + e.message);
        }
      }
    }
    for (const t of col.tables.values()) {
      const n = t.name;
      if (has(n)) { try { db.exec('DROP TABLE `' + n + '`'); } catch (e) { } }
      const types = t.cols.map((c, i) => typeOf(t.rows.map(r => r[i])));
      try { db.exec('CREATE TABLE `' + n + '` (' + t.cols.map((c, i) => '`' + c + '` ' + types[i]).join(', ') + ')'); }
      catch (e) { errors.push('table ' + n + ' : ' + e.message); continue; }
      db.tables[n].data = t.rows.map(r => { const o = {}; t.cols.forEach((c, i) => { o[c] = r[i] === undefined ? null : r[i]; }); return o; });
    }
    const info = Object.keys(db.tables).map(n => {
      const tb = db.tables[n];
      const cols = (tb.columns || []).map(c => c.columnid);
      return { name: n, cols: cols.length ? cols : Object.keys((tb.data || [])[0] || {}), count: (tb.data || []).length, from: (col.tables.get(n.toLowerCase()) || {}).from };
    });
    return { db, info, errors };
  }
  /* noms de tables et de colonnes : insensibles à la casse comme sous MySQL */
  function normalize(sql, info) {
    const map = new Map();
    for (const t of info) { map.set(t.name.toLowerCase(), t.name); for (const c of t.cols) if (!map.has(c.toLowerCase())) map.set(c.toLowerCase(), c); }
    let out = '', i = 0;
    const s = String(sql);
    while (i < s.length) {
      const c = s[i];
      if (c === '\'' || c === '"' || c === '`') { let j = i + 1; while (j < s.length && (s[j] !== c || s[j - 1] === '\\')) j++; out += s.slice(i, j + 1); i = j + 1; continue; }
      if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[\w]/.test(s[j])) j++; const w = s.slice(i, j); const m = map.get(w.toLowerCase()); out += m && m !== w ? m : w; i = j; continue; }
      out += c; i++;
    }
    return out;
  }
  /* nombre de décimales affichées par MySQL : AVG et division → 4, ROUND(x, n) → n */
  function decimalCols(sql) {
    const map = new Map();
    const items = []; let depth = 0, cur = '';
    const m0 = /^\s*select\s+(?:distinct\s+)?([\s\S]*?)\s+from\b/i.exec(sql); if (!m0) return map;
    for (const c of m0[1]) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && !depth) { items.push(cur); cur = ''; } else cur += c; }
    items.push(cur);
    for (const it of items) {
      const a = /\s(?:as\s+)?("([^"]+)"|'([^']+)'|`([^`]+)`|([A-Za-z_]\w*))\s*$/i.exec(it.trim());
      const alias = a ? (a[2] || a[3] || a[4] || a[5]) : null;
      const expr = a ? it.trim().slice(0, it.trim().length - a[0].length) : it.trim();
      let d = null;
      const r = /^round\s*\(([\s\S]*),\s*(\d+)\s*\)$/i.exec(expr.trim());
      if (r) d = +r[2]; else if (/^round\s*\(/i.test(expr.trim())) d = 0; else if (/avg\s*\(|\//i.test(expr)) d = 4;
      if (d != null && alias) map.set(alias.toLowerCase(), d);
    }
    return map;
  }
  const KW = new Set(('select distinct all from where and or not in is null like between group by order asc desc having as on join inner left right outer full cross union intersect except minus exists any some ' +
    'count sum avg min max round upper lower length concat substr substring abs year month day now date time case when then else end limit offset insert into values update set delete create table drop alter ' +
    'int integer varchar char text float double decimal number string true false if ifnull coalesce cast mod div trim').split(' '));
  /* MySQL refuse les colonnes inconnues ; alasql les ignore : on vérifie avant d'exécuter */
  function unknownName(st, info) {
    {
      const plain0 = st.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
      const rf = /\bfrom\s+([\s\S]*?)(?=\bwhere\b|\bgroup\b|\border\b|\bhaving\b|\bunion\b|\bintersect\b|\bexcept\b|\blimit\b|\)|;|$)/gi;
      let mf;
      while ((mf = rf.exec(plain0))) for (const part of mf[1].split(/,|\bjoin\b/i)) {
        const w = (/^\s*(?:inner|left|right|outer|cross|natural|\s)*`?([A-Za-z_]\w*)/i.exec(part) || [])[1];
        if (w && !/^(select)$/i.test(w) && !info.some(t => t.name.toLowerCase() === w.toLowerCase())) return 'La table « ' + w + ' » n\'existe pas. Tables disponibles : ' + info.map(x => x.name).join(', ') + '.';
      }
    }
    const known = new Set(); for (const t of info) { known.add(t.name.toLowerCase()); for (const c of t.cols) known.add(c.toLowerCase()); }
    const plain = st.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`[^`]*`/g, ' 0 ');
    const aliases = new Set();
    let m; const ra = /\bas\s+([A-Za-z_]\w*)/gi; while ((m = ra.exec(plain))) aliases.add(m[1].toLowerCase());
    const quotedAlias = /\bas\s+["'`]([^"'`]+)["'`]/gi; while ((m = quotedAlias.exec(st))) aliases.add(m[1].toLowerCase());
    const toks = plain.match(/[A-Za-z_][\w]*(?:\s*\.\s*[A-Za-z_]\w*)?/g) || [];
    // alias de table : mot qui suit directement un nom de table dans FROM
    const rt = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\b/g; while ((m = rt.exec(plain))) if (info.some(t => t.name.toLowerCase() === m[1].toLowerCase()) && !KW.has(m[2].toLowerCase())) aliases.add(m[2].toLowerCase());
    for (const t of toks) {
      const parts = t.split('.').map(x => x.trim().toLowerCase());
      void 0;
      for (const p of parts) if (!KW.has(p) && !known.has(p) && !aliases.has(p)) {
        if (parts.length === 2 && p === parts[0]) return 'La table « ' + p + ' » n\'existe pas. Tables disponibles : ' + info.map(x => x.name).join(', ') + '.';
        return 'Colonne inconnue « ' + p + ' » : elle n\'existe dans aucune table de la base' + (/^(select|where|order|group)$/.test(p) ? '' : '') + '.';
      }
    }
    return null;
  }
  function frErr(msg, info) {
    const m = String(msg || '');
    let r;
    if ((r = /Column does not exist: (.+)$/i.exec(m))) return 'La colonne « ' + r[1] + ' » n\'existe pas dans les tables de la requête.';
    if ((r = /Table does not exist: (.+)$/i.exec(m))) return 'La table « ' + r[1] + ' » n\'existe pas. Tables disponibles : ' + info.map(t => t.name).join(', ') + '.';
    if (/Parse error/i.test(m)) { const near = /\n(.*)\n[-]*\^/.exec(m); return 'Erreur de syntaxe SQL' + (near ? ' près de : ' + near[1].trim().slice(-60) : '') + '. Vérifie les virgules, les guillemets et l\'ordre SELECT … FROM … WHERE … GROUP BY … ORDER BY.'; }
    return m;
  }
  /* exécution : une ou plusieurs instructions */
  function run(alasql, base, sql) {
    const env = build(alasql, base);
    const results = [];
    for (const st0 of statements(sql)) {
      const st = normalize(st0, env.info);
      const unk = /^\s*(select|with)\b/i.test(st) ? unknownName(st, env.info) : null;
      if (unk) { results.push({ sql: st0, error: unk }); continue; }
      try {
        const setop = splitSetOps(st);
        if (setop) { results.push(Object.assign({ sql: st0, dec: decimalCols(setop.parts[0]) }, runSetOps(env, setop))); continue; }
        let res = env.db.exec(st);
        if (Array.isArray(res) && res.length && Array.isArray(res[0])) res = res[res.length - 1];
        if (Array.isArray(res)) {
          const cols = res.length ? Object.keys(res[0]) : (/^\s*select/i.test(st) ? selectHeads(st) : []);
          results.push({ sql: st0, cols, rows: res.map(o => cols.map(c => o[c] === undefined ? null : o[c])), dec: decimalCols(st0) });
        } else results.push({ sql: st0, info: typeof res === 'number' ? res + ' ligne(s) modifiée(s) (seulement dans cette exécution)' : 'OK' });
      } catch (e) { results.push({ sql: st0, error: frErr(e.message, env.info) }); }
    }
    return { results, info: env.info, errors: env.errors };
  }
  /* UNION / INTERSECT / EXCEPT au premier niveau, avec un ORDER BY final éventuel */
  function splitSetOps(st) {
    const plain = st.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, m => 'x'.repeat(m.length));
    const parts = [], ops = []; let depth = 0, last = 0;
    const re = /\b(union\s+all|union|intersect|except|minus)\b|[()]/gi; let m;
    while ((m = re.exec(plain))) {
      if (m[0] === '(') { depth++; continue; } if (m[0] === ')') { depth--; continue; }
      if (depth) continue;
      parts.push(st.slice(last, m.index)); ops.push(m[1].toLowerCase().replace(/\s+/g, ' ')); last = m.index + m[0].length;
    }
    if (!ops.length) return null;
    let tail = st.slice(last), order = null;
    const om = /\border\s+by\s+([\s\S]*)$/i.exec(plain.slice(last));
    if (om) { order = tail.slice(om.index + 8).trim(); tail = tail.slice(0, om.index); }
    parts.push(tail);
    return { parts: parts.map(p => p.trim().replace(/^\(([\s\S]*)\)$/, '$1')), ops, order };
  }
  function runSetOps(env, so) {
    const res = so.parts.map(p => env.db.exec(p));
    const cols = res[0].length ? Object.keys(res[0][0]) : selectHeads(so.parts[0]);
    const rowsOf = r => r.map(o => { const k = Object.keys(o); return cols.map((c, i) => o[k[i]] === undefined ? null : o[k[i]]); });
    const key = r => JSON.stringify(r);
    const dedupe = rows => { const seen = new Set(); return rows.filter(r => { const k = key(r); if (seen.has(k)) return false; seen.add(k); return true; }); };
    let acc = rowsOf(res[0]), anyDistinct = false;
    so.ops.forEach((op, i) => {
      const b = rowsOf(res[i + 1]), bk = new Set(b.map(key));
      if (op === 'union all') acc = acc.concat(b);
      else if (op === 'union') { acc = dedupe(acc.concat(b)); anyDistinct = true; }
      else if (op === 'intersect') acc = dedupe(acc.filter(r => bk.has(key(r))));
      else acc = dedupe(acc.filter(r => !bk.has(key(r))));
    });
    if (so.order) {
      const objs = acc.map(r => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; });
      const sorted = env.db.exec('SELECT * FROM ? ORDER BY ' + so.order.replace(/;\s*$/, ''), [objs]);
      acc = sorted.map(o => cols.map(c => o[c]));
    }
    return { cols, rows: acc };
  }
  function selectHeads(st) {
    const m = /^\s*select\s+(distinct\s+)?([\s\S]*?)\s+from\b/i.exec(st); if (!m) return [];
    return m[2].split(',').map(x => { const a = /\bas\s+["'`]?([^"'`]+)["'`]?\s*$/i.exec(x.trim()); return a ? a[1] : x.trim().replace(/^\w+\./, ''); });
  }
  function fmt(v, dec) {
    if (v == null) return 'NULL';
    if (typeof v === 'number') { if (dec != null) return v.toFixed(dec); if (Number.isInteger(v)) return String(v); return String(Math.round(v * 1e6) / 1e6); }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'boolean') return v ? '1' : '0';
    return String(v);
  }
  /* rendu au format MySQL (aligné à gauche comme sur C5) */
  function ascii(r) {
    const decOf = c => { const k = String(c).toLowerCase(); if (r.dec && r.dec.has(k)) return r.dec.get(k); const rr = /^round\(.*,\s*(\d+)\)$/i.exec(c); if (rr) return +rr[1]; if (/^round\(/i.test(c)) return 0; return /avg\s*\(|\s\/\s/i.test(c) ? 4 : null; };
    const decs = r.cols.map(decOf);
    const cells = r.rows.map(row => row.map((v, i) => fmt(v, typeof v === 'number' ? decs[i] : null)));
    if (!r.cols.length) return 'Empty set';
    const w = r.cols.map((c, i) => Math.max(String(c).length, ...cells.map(x => x[i].length)));
    const sep = '+' + w.map(x => '-'.repeat(x + 2)).join('+') + '+';
    const line = vals => '| ' + vals.map((v, i) => String(v).padEnd(w[i])).join(' | ') + ' |';
    if (!cells.length) return 'Empty set';
    return [sep, line(r.cols), sep, ...cells.map(line), sep, cells.length + (cells.length > 1 ? ' rows in set' : ' row in set')].join('\n');
  }
  /* annotations de preuve : <<<<< sur les lignes, ^^^^ sous les colonnes */
  function annotate(text, rowNotes, colNotes, footer) {
    const lines = text.split('\n');
    if (lines[0] === 'Empty set') return text + (footer ? '  <<<<< ' + footer : '');
    const head = lines[1];
    const starts = [], widths = [];
    for (let i = 0; i < head.length; i++) if (head[i] === '|' && i < head.length - 1) { const e = head.indexOf('|', i + 1); starts.push(i + 2); widths.push(e - i - 3); }
    const names = splitRow(head);
    const nData = lines.length - 5;
    const out = lines.slice(0, 3);
    for (let r = 0; r < nData; r++) { const note = rowNotes && (rowNotes[r + 1] || rowNotes[String(r + 1)]); out.push(lines[3 + r] + (note ? ' <<<<< ' + note : '')); }
    out.push(lines[3 + nData]);
    const cn = [];
    for (const [k, v] of Object.entries(colNotes || {})) { const i = names.findIndex(n => n.toLowerCase() === String(k).toLowerCase()); if (i >= 0) cn.push({ i, labels: [].concat(v).filter(Boolean).map(String) }); }
    cn.sort((a, b) => a.i - b.i);
    if (cn.length) {
      const depth = Math.max(...cn.map(c => c.labels.length));
      const rowsTxt = [];
      for (let L = 0; L <= depth; L++) {
        let s = '';
        for (const c of cn) {
          const txt = L === 0 ? '^'.repeat(Math.max(1, Math.min(widths[c.i], Math.max(names[c.i].length, 3)))) : (c.labels[L - 1] || '');
          if (!txt) continue;
          let at = starts[c.i];
          if (s.length > at - (s.length ? 1 : 0)) at = s.length + (s.length ? 1 : 0);
          s = s.padEnd(at) + txt;
        }
        if (s.trim()) rowsTxt.push(s);
      }
      out.push(...rowsTxt);
    }
    out.push(lines[lines.length - 1] + (footer ? '  <<<<< ' + footer : ''));
    return out.join('\n');
  }
  /* fichier texte des tables, au format de C5 */
  function dumpText(title, tables) {
    let s = title + '\n';
    const empty = tables.filter(t => !t.rows.length).map(t => t.name);
    if (empty.length) s += 'À compléter depuis C5 : ' + empty.join(', ') + '.\n';
    for (const t of tables) {
      const r = { cols: t.cols, rows: t.rows };
      const w = t.cols.map((c, i) => Math.max(String(c).length, ...t.rows.map(x => fmt(x[i]).length)));
      const sep = '+' + w.map(x => '-'.repeat(x + 2)).join('+') + '+';
      const line = vals => '| ' + vals.map((v, i) => String(v).padEnd(w[i])).join(' | ') + ' |';
      s += '\nSELECT * FROM ' + t.name + ';\n\n' + [sep, line(t.cols), sep, ...t.rows.map(x => line(x.map(v => fmt(v)))), sep].join('\n') + '\n';
      void r;
    }
    return s;
  }
  function schema(info, base, limit) {
    let s = '';
    for (const t of info) s += t.name + ' (' + t.cols.join(', ') + ') : ' + t.count + ' ligne' + (t.count > 1 ? 's' : '') + '\n';
    return s;
  }
  return { parseAscii, dumpText, statements, collect, build, run, ascii, annotate, normalize, schema, fmt };
})();
if (typeof module !== 'undefined') module.exports = SQLKIT;
