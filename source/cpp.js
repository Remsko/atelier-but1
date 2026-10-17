/* Mini compilateur C/C++ -> JavaScript (sous-ensemble pédagogique BUT 1)
 * compile(source) -> { ok, body, warnings } | { ok:false, error:{msg,line}, warnings }
 * Le corps généré est celui d'une fonction async($rt) exécutée par le runtime.
 */
var CPP = (function () {
'use strict';

class CErr extends Error { constructor(msg, line) { super(msg); this.line = line; } }

/* ============================ LEXER ============================ */
const OPS = ['<<=', '>>=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::'];
const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11, '?': 63 };

function lex(src) {
  const toks = [], macros = new Map(), includes = [];
  let i = 0, line = 1, lineStart = true;
  const n = src.length;

  function readEscape() { // i pointe après le '\'
    const c = src[i];
    if (c === 'x') { let j = i + 1, h = ''; while (/[0-9a-fA-F]/.test(src[j] || '') && h.length < 4) h += src[j++]; i = j; return parseInt(h || '0', 16); }
    if (/[0-7]/.test(c)) { let j = i, o = ''; while (/[0-7]/.test(src[j] || '') && o.length < 3) o += src[j++]; i = j; return parseInt(o, 8); }
    i++;
    if (c in ESC) return ESC[c];
    return c.charCodeAt(0);
  }

  function pushTok(t) {
    if (t.t === 'id' && macros.has(t.v) && !t.noexp) {
      const m = macros.get(t.v);
      for (const mt of m) pushTok(Object.assign({}, mt, { line: t.line, noexp: mt.t === 'id' && mt.v === t.v }));
      return;
    }
    toks.push(t);
  }

  function pp(text, ln) {
    const m = /^#\s*(\w+)\s*(.*)$/.exec(text.trim());
    if (!m) return;
    const d = m[1], rest = m[2];
    if (d === 'include') {
      const mm = /^[<"]([^>"]+)[>"]/.exec(rest);
      if (mm) includes.push(mm[1].trim());
    } else if (d === 'define') {
      const mm = /^([A-Za-z_]\w*)(\()?(.*)$/.exec(rest);
      if (!mm) throw new CErr('#define mal formé', ln);
      if (mm[2]) throw new CErr('Les macros avec paramètres (#define ' + mm[1] + '(...)) ne sont pas supportées : utilise une fonction', ln);
      const sub = lex(mm[3]);
      macros.set(mm[1], sub.toks.slice(0, -1));
    } else if (d === 'undef') {
      macros.delete(rest.trim());
    }
    // #ifndef, #pragma, #endif ... ignorés
  }

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) throw new CErr('Commentaire /* jamais fermé par */', line);
      for (let k = i; k < j; k++) if (src[k] === '\n') line++;
      i = j + 2; continue;
    }
    if (c === '#' && lineStart) {
      let text = '', j = i; const ln = line;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] === '\n') { j += 2; line++; continue; }
        if (src[j] === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; break; }
        text += src[j++];
      }
      pp(text, ln); i = j; continue;
    }
    lineStart = false;
    // identifiants
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i + 1; while (j < n && /[A-Za-z0-9_À-ɏ]/.test(src[j])) j++;
      const w = src.slice(i, j);
      // préfixes de littéraux L"", u8"" : on les ignore
      if ((w === 'L' || w === 'u8' || w === 'u' || w === 'U') && (src[j] === '"' || src[j] === "'")) { i = j; continue; }
      pushTok({ t: 'id', v: w, line }); i = j; continue;
    }
    // nombres
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:[0-9][0-9']*\.?[0-9']*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i, i + 80));
      let txt = m[1].replace(/'/g, ''); const suf = m[2].toLowerCase();
      let val, nt;
      if (/^0[xX]/.test(txt)) { val = parseInt(txt.slice(2), 16); nt = 'int'; }
      else if (/^0[bB]/.test(txt)) { val = parseInt(txt.slice(2), 2); nt = 'int'; }
      else if (/[.eE]/.test(txt)) { val = parseFloat(txt); nt = suf.includes('f') ? 'float' : 'double'; }
      else if (/^0[0-7]+$/.test(txt)) { val = parseInt(txt, 8); nt = 'int'; }
      else { val = parseInt(txt, 10); nt = 'int'; }
      if (nt === 'int' && (suf.includes('l') || val > 2147483647)) nt = 'long';
      if (nt === 'int' && suf.includes('u')) nt = 'uint';
      pushTok({ t: 'num', v: val, nt, line, raw: m[0] }); i += m[0].length; continue;
    }
    if (c === '"') {
      let s = ''; i++;
      while (true) {
        if (i >= n || src[i] === '\n') throw new CErr('Chaîne de caractères non fermée (il manque un ")', line);
        const d = src[i];
        if (d === '"') { i++; break; }
        if (d === '\\') { i++; if (src[i] === '\n') { i++; line++; continue; } s += String.fromCharCode(readEscape()); continue; }
        s += d; i++;
      }
      pushTok({ t: 'str', v: s, line }); continue;
    }
    if (c === "'") {
      i++; let v;
      if (src[i] === '\\') { i++; v = readEscape(); }
      else if (src[i] === "'") throw new CErr("Caractère vide '' : un char contient exactement un caractère", line);
      else { v = src.codePointAt(i); i += v > 0xFFFF ? 2 : 1; }
      if (src[i] !== "'") {
        throw new CErr("Un char ne contient qu'un seul caractère entre apostrophes ' ' (pour du texte, utilise des guillemets \" \")", line);
      }
      i++;
      pushTok({ t: 'chr', v, line }); continue;
    }
    let op = null;
    for (const o of OPS) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) {
      if ('+-*/%<>=!&|^~?:;,.()[]{}'.includes(c)) op = c;
      else throw new CErr('Caractère inattendu « ' + c + ' »', line);
    }
    pushTok({ t: 'op', v: op, line }); i += op.length;
  }
  toks.push({ t: 'eof', v: '<fin>', line });
  return { toks, includes };
}

/* ============================ TYPES ============================ */
const T = k => ({ k });
const RANK = { bool: 0, char: 1, short: 2, int: 3, uint: 4, long: 5, float: 6, double: 7 };
const isArith = t => t && t.k in RANK;
const isIntegral = t => t && t.k in RANK && RANK[t.k] <= 5;
const isFloat = t => t && (t.k === 'float' || t.k === 'double');
const isAgg = t => t && (t.k === 'array' || t.k === 'vector' || t.k === 'struct');
function arith(a, b) {
  const r = Math.max(RANK[a.k], RANK[b.k], 3);
  for (const k in RANK) if (RANK[k] === r) return T(k);
}
function tname(t) {
  if (!t) return '?';
  switch (t.k) {
    case 'array': return tname(t.of) + '[]';
    case 'vector': return 'vector<' + tname(t.of) + '>';
    case 'struct': return t.name;
    case 'uint': return 'unsigned int';
    case 'long': return 'long long';
    default: return t.k;
  }
}
const SIZEOF = { bool: 1, char: 1, short: 2, int: 4, uint: 4, long: 8, float: 4, double: 8, string: 32 };

/* ============================ PARSER ============================ */
const BASE_WORDS = new Set(['void', 'bool', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'wchar_t']);
const QUALS = new Set(['const', 'static', 'volatile', 'inline', 'constexpr', 'register', 'extern', 'mutable']);

class Parser {
  constructor(toks) {
    this.toks = toks; this.p = 0;
    this.structs = new Map(); this.typedefs = new Map();
    this.warnings = [];
  }
  peek(k = 0) { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }
  next() { return this.toks[this.p++]; }
  is(v, k = 0) { const t = this.peek(k); return (t.t === 'op' || t.t === 'id') && t.v === v; }
  eat(v) { if (this.is(v)) { this.p++; return true; } return false; }
  expect(v, what) {
    const t = this.peek();
    if (t.t !== 'eof' && (t.t === 'op' || t.t === 'id') && t.v === v) return this.next();
    let line = t.line;
    // erreur classique : point-virgule manquant -> on pointe la ligne précédente
    if (v === ';' && this.p > 0) line = this.toks[this.p - 1].line;
    throw new CErr("« " + v + " » attendu" + (what ? ' ' + what : '') + (t.t === 'eof' ? ' avant la fin du fichier' : ", trouvé « " + t.v + " »"), line);
  }
  ident(what) {
    const t = this.peek();
    if (t.t !== 'id') throw new CErr('Nom ' + (what || "d'identifiant") + ' attendu, trouvé « ' + t.v + ' »', t.line);
    this.p++; return t.v;
  }

  isTypeStart(k = 0) {
    const t = this.peek(k);
    if (t.t !== 'id') return false;
    const v = t.v;
    if (BASE_WORDS.has(v) || QUALS.has(v) || v === 'string' || v === 'vector' || v === 'auto' || v === 'size_t' || v === 'struct') return true;
    if (this.structs.has(v) || this.typedefs.has(v)) return true;
    if (v === 'std' && this.is('::', k + 1)) {
      const w = this.peek(k + 2).v;
      return w === 'string' || w === 'vector' || w === 'size_t';
    }
    return false;
  }

  // Lit un type de base (sans déclarateur)
  parseType() {
    const line = this.peek().line;
    let isConst = false, words = [], base = null, std = false;
    for (;;) {
      const t = this.peek();
      if (t.t !== 'id') break;
      if (QUALS.has(t.v)) { if (t.v === 'const' || t.v === 'constexpr') isConst = true; this.p++; continue; }
      if (t.v === 'std' && this.is('::', 1)) { this.p += 2; std = true; continue; }
      if (BASE_WORDS.has(t.v)) { words.push(t.v); this.p++; continue; }
      if (words.length) break;
      if (t.v === 'struct' ) { this.p++; const nm = this.ident('de structure'); if (!this.structs.has(nm)) throw new CErr('Structure « ' + nm + ' » inconnue', t.line); base = { k: 'struct', name: nm }; break; }
      if (t.v === 'string') { this.p++; base = { k: 'string', std }; break; }
      if (t.v === 'size_t') { this.p++; base = T('long'); break; }
      if (t.v === 'auto') { this.p++; base = T('auto'); break; }
      if (t.v === 'vector') {
        this.p++; this.expect('<', 'après vector');
        const el = this.parseFullType();
        this.closeAngle();
        base = { k: 'vector', of: el, std }; break;
      }
      if (this.structs.has(t.v)) { this.p++; base = { k: 'struct', name: t.v }; break; }
      if (this.typedefs.has(t.v)) { this.p++; base = JSON.parse(JSON.stringify(this.typedefs.get(t.v))); break; }
      break;
    }
    while (this.peek().t === 'id' && QUALS.has(this.peek().v)) { if (this.peek().v === 'const') isConst = true; this.p++; }
    if (!base) {
      if (!words.length) throw new CErr('Type attendu, trouvé « ' + this.peek().v + ' »', line);
      const has = w => words.includes(w);
      const longs = words.filter(w => w === 'long').length;
      if (has('double')) base = T('double');
      else if (has('float')) base = T('float');
      else if (has('char') || has('wchar_t')) base = T('char');
      else if (has('bool')) base = T('bool');
      else if (has('void')) base = T('void');
      else if (has('short')) base = T('short');
      else if (longs >= 1) base = T('long');
      else if (has('unsigned')) base = T('uint');
      else base = T('int');
    }
    if (isConst) base.cst = true;
    // char* et const char* : traités comme des chaînes
    if (base.k === 'char' && this.is('*') ) {
      this.p++; base = { k: 'string', cstr: true, cst: isConst };
    }
    if (this.is('*')) throw new CErr('Les pointeurs (*) ne sont pas supportés par cet exécuteur : utilise des références (&), des tableaux ou vector', this.peek().line);
    return base;
  }
  // type complet pour les templates : vector<int>, vector<vector<int>>
  parseFullType() { return this.parseType(); }
  closeAngle() {
    const t = this.peek();
    if (t.t === 'op' && t.v === '>>') { // vector<vector<int>>
      t.v = '>'; return;
    }
    this.expect('>', 'pour fermer le template');
  }

  /* ---------- Programme ---------- */
  parseProgram() {
    const items = [];
    let usingStd = false;
    while (this.peek().t !== 'eof') {
      const t = this.peek();
      if (this.eat(';')) continue;
      if (t.v === 'using') {
        this.p++;
        if (this.eat('namespace')) { const ns = this.ident('de namespace'); if (ns === 'std') usingStd = true; this.expect(';', 'après using namespace ' + ns); continue; }
        // using std::cout;
        while (!this.is(';') && this.peek().t !== 'eof') this.p++;
        this.expect(';'); usingStd = true; continue;
      }
      if (t.v === 'typedef') {
        this.p++; const ty = this.parseType(); const nm = this.ident('de type');
        this.typedefs.set(nm, ty); this.expect(';'); continue;
      }
      if ((t.v === 'struct' || t.v === 'class') && this.peek(1).t === 'id' && this.is('{', 2)) {
        items.push(this.parseStruct()); continue;
      }
      if (t.v === 'enum') throw new CErr('Les enum ne sont pas encore supportés', t.line);
      if (t.v === 'template') throw new CErr('Les templates ne sont pas supportés', t.line);
      if (t.v === 'namespace') throw new CErr('La déclaration de namespace n\'est pas supportée', t.line);
      if (!this.isTypeStart()) throw new CErr('Déclaration attendue (type, fonction...), trouvé « ' + t.v + ' »', t.line);
      const line = t.line;
      const ty = this.parseType();
      // fonction ?
      if (this.peek().t === 'id' && this.is('(', 1)) {
        items.push(this.parseFunction(ty, line)); continue;
      }
      items.push(this.parseDeclRest(ty, line, true));
    }
    return { items, usingStd };
  }

  parseStruct() {
    const line = this.next().line;
    const name = this.ident('de structure');
    this.structs.set(name, null);
    this.expect('{');
    const fields = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw new CErr('« } » manquant pour fermer la structure ' + name, line);
      if (this.is('public') || this.is('private')) { this.p++; this.expect(':'); continue; }
      const fl = this.peek().line;
      const ty = this.parseType();
      if (this.peek().t === 'id' && this.is('(', 1)) throw new CErr('Les fonctions membres (méthodes) ne sont pas supportées dans les structures', fl);
      const d = this.parseDeclRest(ty, fl, true);
      for (const dd of d.decls) fields.push({ name: dd.name, type: dd.type, init: dd.init, line: fl });
    }
    this.expect('}');
    const node = { k: 'struct', name, fields, line };
    this.structs.set(name, node);
    // struct S {...} a, b;
    if (!this.is(';')) {
      const d = this.parseDeclRest({ k: 'struct', name }, line, true);
      return { k: 'multi', list: [node, d] };
    }
    this.expect(';', 'après la déclaration de la structure ' + name);
    return node;
  }

  parseFunction(ret, line) {
    const name = this.ident('de fonction');
    this.expect('(');
    const params = [];
    if (this.is('void') && this.is(')', 1)) this.p++;
    if (!this.is(')')) {
      do {
        const pl = this.peek().line;
        if (this.is('...')) throw new CErr('Les fonctions à nombre variable d\'arguments ne sont pas supportées', pl);
        let ty = this.parseType();
        let ref = false;
        if (this.eat('&')) ref = true;
        let pname = null;
        if (this.peek().t === 'id') pname = this.next().v;
        // tableaux : int t[], int m[][10]
        const dims = [];
        while (this.eat('[')) { dims.push(this.is(']') ? null : this.parseExpr()); this.expect(']'); }
        if (dims.length) ty = this.wrapArray(ty, dims);
        let def = null;
        if (this.eat('=')) def = this.parseAssign();
        params.push({ name: pname, type: ty, ref, def, line: pl });
      } while (this.eat(','));
    }
    this.expect(')', 'pour fermer la liste des paramètres de ' + name);
    while (this.is('const') || this.is('noexcept')) this.p++;
    if (this.eat(';')) return { k: 'proto', name, ret, params, line };
    if (!this.is('{')) throw new CErr('« { » attendu pour le corps de la fonction ' + name + ' (ou « ; » pour un prototype)', this.peek().line);
    const body = this.parseBlock();
    return { k: 'func', name, ret, params, body, line, endLine: this.toks[this.p - 1].line };
  }

  wrapArray(ty, dims) {
    let t = ty;
    for (let i = dims.length - 1; i >= 0; i--) t = { k: 'array', of: t, dim: dims[i] };
    return t;
  }

  // après le type : déclarateurs séparés par des virgules
  parseDeclRest(ty, line, needSemi) {
    const decls = [];
    do {
      const dl = this.peek().line;
      let ref = false;
      if (this.eat('&')) ref = true;
      if (this.is('*')) throw new CErr('Les pointeurs (*) ne sont pas supportés par cet exécuteur : utilise des références (&), des tableaux ou vector', dl);
      const name = this.ident('de variable');
      const dims = [];
      while (this.eat('[')) { dims.push(this.is(']') ? null : this.parseExpr()); this.expect(']', 'pour fermer la taille du tableau'); }
      let t = JSON.parse(JSON.stringify(ty));
      if (dims.length) {
        if (t.k === 'char' && dims.length === 1) t = { k: 'string', carr: true, dim: dims[0] }; // tableau de char = chaîne
        else if (t.k === 'char') t = this.wrapArray({ k: 'string', carr: true, dim: dims[dims.length - 1] }, dims.slice(0, -1));
        else t = this.wrapArray(t, dims);
      }
      let init = null, ctor = null;
      if (this.eat('=')) init = this.is('{') ? this.parseBraceList() : this.parseAssign();
      else if (this.is('{')) init = this.parseBraceList();
      else if (this.is('(')) { this.p++; ctor = []; if (!this.is(')')) { do ctor.push(this.parseAssign()); while (this.eat(',')); } this.expect(')'); }
      decls.push({ name, type: t, init, ctor, ref, line: dl });
    } while (this.eat(','));
    if (needSemi) this.expect(';', 'à la fin de la déclaration');
    return { k: 'decl', decls, line };
  }

  parseBraceList() {
    const line = this.expect('{').line;
    const items = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.parseBraceList() : this.parseAssign());
      if (!this.eat(',')) break;
    }
    this.expect('}', "pour fermer la liste d'initialisation");
    return { k: 'list', items, line };
  }

  /* ---------- Instructions ---------- */
  parseBlock() {
    const line = this.expect('{').line;
    const body = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw new CErr('« } » manquante : un bloc ouvert ligne ' + line + ' n\'est jamais fermé', line);
      body.push(this.parseStmt());
    }
    this.expect('}');
    return { k: 'block', body, line };
  }

  parseStmt() {
    const t = this.peek(), line = t.line;
    if (t.t === 'op' && t.v === '{') return this.parseBlock();
    if (t.t === 'op' && t.v === ';') { this.p++; return { k: 'empty', line }; }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.p++; this.expect('(', 'après if'); const c = this.parseExpr(); this.expect(')', 'pour fermer la condition du if');
          if (this.is(';')) this.warnings.push({ line, msg: "Point-virgule juste après if (...) : l'instruction qui suit sera toujours exécutée" });
          const a = this.parseStmt(); let b = null;
          if (this.eat('else')) b = this.parseStmt();
          return { k: 'if', c, a, b, line };
        }
        case 'while': {
          this.p++; this.expect('(', 'après while'); const c = this.parseExpr(); this.expect(')', 'pour fermer la condition du while');
          if (this.is(';')) this.warnings.push({ line, msg: "Point-virgule juste après while (...) : la boucle est vide (risque de boucle infinie)" });
          return { k: 'while', c, body: this.parseStmt(), line };
        }
        case 'do': {
          this.p++; const body = this.parseStmt();
          this.expect('while', 'après le bloc do { ... }'); this.expect('('); const c = this.parseExpr(); this.expect(')');
          this.expect(';', 'après do { ... } while (...)');
          return { k: 'do', c, body, line };
        }
        case 'for': {
          this.p++; this.expect('(', 'après for');
          let init = null;
          if (this.is(';')) this.p++;
          else if (this.isTypeStart()) {
            const save = this.p;
            const ty = this.parseType();
            let ref = this.eat('&');
            if (this.peek().t === 'id' && this.is(':', 1)) {
              const name = this.next().v; this.p++;
              const coll = this.parseExpr(); this.expect(')');
              return { k: 'rangefor', type: ty, ref, name, coll, body: this.parseStmt(), line };
            }
            this.p = save;
            const ty2 = this.parseType();
            init = this.parseDeclRest(ty2, line, true);
          } else { init = { k: 'expr', e: this.parseExpr(), line }; this.expect(';', 'dans le for'); }
          const c = this.is(';') ? null : this.parseExpr(); this.expect(';', 'dans le for (après la condition)');
          const step = this.is(')') ? null : this.parseExpr(); this.expect(')', 'pour fermer le for');
          if (this.is(';')) this.warnings.push({ line, msg: "Point-virgule juste après for (...) : la boucle est vide" });
          return { k: 'for', init, c, step, body: this.parseStmt(), line };
        }
        case 'switch': {
          this.p++; this.expect('('); const e = this.parseExpr(); this.expect(')'); this.expect('{');
          const cases = []; let cur = null;
          while (!this.is('}')) {
            if (this.peek().t === 'eof') throw new CErr('« } » manquante pour le switch', line);
            if (this.eat('case')) { const v = this.parseTernary(); this.expect(':', 'après case'); cur = { test: v, body: [], line: this.peek().line }; cases.push(cur); continue; }
            if (this.eat('default')) { this.expect(':', 'après default'); cur = { test: null, body: [] }; cases.push(cur); continue; }
            if (!cur) throw new CErr('Instruction avant le premier case du switch', this.peek().line);
            cur.body.push(this.parseStmt());
          }
          this.expect('}');
          return { k: 'switch', e, cases, line };
        }
        case 'break': this.p++; this.expect(';', 'après break'); return { k: 'break', line };
        case 'continue': this.p++; this.expect(';', 'après continue'); return { k: 'continue', line };
        case 'return': {
          this.p++; const e = this.is(';') ? null : (this.is('{') ? this.parseBraceList() : this.parseExpr());
          this.expect(';', 'après return'); return { k: 'return', e, line };
        }
        case 'goto': throw new CErr("goto n'est pas supporté", line);
        case 'try': case 'throw': throw new CErr('Les exceptions (try/throw) ne sont pas supportées', line);
        case 'using': { this.p++; while (!this.is(';') && this.peek().t !== 'eof') this.p++; this.expect(';'); return { k: 'empty', line, usingStd: true }; }
      }
      if (this.isTypeStart() && !(this.peek(1).t === 'op' && this.peek(1).v === '(' && BASE_WORDS.has(t.v))) {
        // struct locale ?
        if (t.v === 'struct' && this.peek(1).t === 'id' && this.is('{', 2)) throw new CErr('Déclare les structures en dehors des fonctions (avant main)', line);
        const ty = this.parseType();
        if (this.peek().t === 'id' && this.is('(', 1) && this.isProtoAhead()) {
          throw new CErr('Déclaration de fonction à l\'intérieur d\'une fonction : déplace-la avant main', line);
        }
        return this.parseDeclRest(ty, line, true);
      }
    }
    const e = this.parseExpr();
    this.expect(';', 'à la fin de l\'instruction');
    return { k: 'expr', e, line };
  }
  isProtoAhead() { // int f(int a); dans un bloc
    const k = 2; const t = this.peek(k);
    return (t.t === 'id' && (BASE_WORDS.has(t.v) || t.v === 'string')) || (t.t === 'op' && t.v === ')' && this.is(';', 3));
  }

  /* ---------- Expressions ---------- */
  parseExpr() {
    let e = this.parseAssign();
    while (this.is(',')) { const line = this.next().line; e = { k: 'comma', a: e, b: this.parseAssign(), line }; }
    return e;
  }
  parseAssign() {
    const l = this.parseTernary();
    const t = this.peek();
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) {
      this.p++;
      const r = this.is('{') ? this.parseBraceList() : this.parseAssign();
      return { k: 'assign', op: t.v, l, r, line: t.line };
    }
    return l;
  }
  parseTernary() {
    const c = this.parseBin(0);
    if (this.is('?')) {
      const line = this.next().line;
      const a = this.parseExpr(); this.expect(':', 'dans l\'opérateur ternaire ? :');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, line };
    }
    return c;
  }
  parseBin(level) {
    const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
    if (level >= LEVELS.length) return this.parseUnary();
    let l = this.parseBin(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && LEVELS[level].includes(t.v)) {
        this.p++;
        const r = this.parseBin(level + 1);
        l = { k: 'bin', op: t.v, l, r, line: t.line };
      } else if (t.t === 'id' && level <= 1 && ((level === 0 && t.v === 'or') || (level === 1 && t.v === 'and'))) {
        this.p++; l = { k: 'bin', op: level === 0 ? '||' : '&&', l, r: this.parseBin(level + 1), line: t.line };
      } else break;
    }
    return l;
  }
  parseUnary() {
    const t = this.peek(), line = t.line;
    if (t.t === 'op') {
      if (['!', '~', '-', '+'].includes(t.v)) { this.p++; return { k: 'un', op: t.v, e: this.parseUnary(), line }; }
      if (t.v === '++' || t.v === '--') { this.p++; return { k: 'pre', op: t.v, e: this.parseUnary(), line }; }
      if (t.v === '&') { this.p++; return { k: 'addr', e: this.parseUnary(), line }; }
      if (t.v === '*') throw new CErr('Le déréférencement de pointeur (*) n\'est pas supporté', line);
      if (t.v === '(' && this.isTypeStart(1)) {
        // cast C : (float)(x)
        const save = this.p; this.p++;
        try {
          const ty = this.parseType();
          if (this.eat(')')) return { k: 'cast', type: ty, e: this.parseUnary(), line };
        } catch (e) { /* pas un cast */ }
        this.p = save;
      }
    }
    if (t.t === 'id' && t.v === 'not') { this.p++; return { k: 'un', op: '!', e: this.parseUnary(), line }; }
    if (t.t === 'id' && t.v === 'sizeof') {
      this.p++;
      if (this.is('(') && this.isTypeStart(1)) { this.p++; const ty = this.parseType(); this.expect(')'); return { k: 'sizeof', type: ty, line }; }
      return { k: 'sizeof', e: this.parseUnary(), line };
    }
    return this.parsePostfix(this.parsePrimary());
  }
  parsePostfix(e) {
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') break;
      if (t.v === '[') { this.p++; const i = this.parseExpr(); this.expect(']'); e = { k: 'index', e, i, line: t.line }; continue; }
      if (t.v === '(') {
        this.p++; const args = [];
        if (!this.is(')')) { do args.push(this.is('{') ? this.parseBraceList() : this.parseAssign()); while (this.eat(',')); }
        this.expect(')', "pour fermer l'appel de fonction");
        e = { k: 'call', f: e, args, line: t.line }; continue;
      }
      if (t.v === '.') { this.p++; const name = this.ident('de membre'); e = { k: 'member', e, name, line: t.line }; continue; }
      if (t.v === '->') throw new CErr("L'opérateur -> (pointeurs) n'est pas supporté", t.line);
      if (t.v === '++' || t.v === '--') { this.p++; e = { k: 'post', op: t.v, e, line: t.line }; continue; }
      break;
    }
    return e;
  }
  parsePrimary() {
    const t = this.next(), line = t.line;
    if (t.t === 'num') return { k: 'num', v: t.v, nt: t.nt, raw: t.raw, line };
    if (t.t === 'str') {
      let v = t.v; while (this.peek().t === 'str') v += this.next().v;
      return { k: 'str', v, line };
    }
    if (t.t === 'chr') return { k: 'chr', v: t.v, line };
    if (t.t === 'op' && t.v === '(') { const e = this.parseExpr(); this.expect(')', 'pour fermer la parenthèse'); return { k: 'paren', e, line }; }
    if (t.t === 'op' && t.v === '{') { this.p--; return this.parseBraceList(); }
    if (t.t === 'id') {
      let v = t.v, std = false;
      if (v === 'true' || v === 'false') return { k: 'bool', v: v === 'true', line };
      if (v === 'nullptr' || v === 'NULL') return { k: 'num', v: 0, nt: 'int', line };
      if (v === 'std' && this.is('::')) { this.p++; std = true; v = this.ident(); }
      if (v === 'static_cast' || v === 'const_cast' || v === 'reinterpret_cast') {
        this.expect('<'); const ty = this.parseType(); this.closeAngle(); this.expect('(');
        const e = this.parseExpr(); this.expect(')'); return { k: 'cast', type: ty, e, line };
      }
      if ((v === 'greater' || v === 'less') && this.is('<')) {
        this.p++; this.parseType(); this.closeAngle();
        return { k: 'id', name: v, std, line };
      }
      if (v === 'numeric_limits') {
        this.expect('<'); const ty = this.parseType(); this.closeAngle(); this.expect('::');
        const what = this.ident(); this.expect('('); this.expect(')');
        return { k: 'limits', type: ty, what, line };
      }
      if (v === 'string' && this.is('::')) { this.p++; const w = this.ident(); if (w === 'npos') return { k: 'num', v: -1, nt: 'long', line }; throw new CErr('string::' + w + ' inconnu', line); }
      // constructeurs / casts fonctionnels : int(x), string(3,'a'), vector<int>(n, 0)
      if (BASE_WORDS.has(v) || v === 'string' || v === 'vector' || this.structs.has(v)) {
        this.p--; if (std) this.p -= 0;
        const ty = this.parseType();
        if (this.is('(') || this.is('{')) {
          let args = [];
          if (this.eat('(')) { if (!this.is(')')) { do args.push(this.parseAssign()); while (this.eat(',')); } this.expect(')'); }
          else { args = this.parseBraceList().items; }
          return { k: 'ctor', type: ty, args, line };
        }
        throw new CErr('Type « ' + tname(ty) + ' » inattendu dans une expression', line);
      }
      return { k: 'id', name: v, std, line };
    }
    throw new CErr('Expression attendue, trouvé « ' + t.v + ' »', line);
  }
}

/* ============================ GÉNÉRATION ============================ */
const STD_NAMES = new Set(['cout', 'cin', 'cerr', 'clog', 'endl', 'fixed', 'scientific', 'setprecision', 'setw', 'setfill', 'left', 'right',
  'boolalpha', 'noboolalpha', 'showpoint', 'noshowpoint', 'defaultfloat', 'getline', 'to_string', 'stoi', 'stod', 'stof', 'stol', 'stoll', 'swap', 'sort', 'reverse',
  'min', 'max', 'string', 'vector', 'flush', 'showpos', 'noshowpos', 'uppercase', 'nouppercase', 'hex', 'dec', 'oct', 'ws']);
const MANIPS = new Set(['endl', 'fixed', 'scientific', 'left', 'right', 'boolalpha', 'noboolalpha', 'showpoint', 'noshowpoint', 'defaultfloat', 'flush', 'showpos', 'noshowpos', 'uppercase', 'nouppercase', 'hex', 'dec', 'oct']);
const NEEDS = {
  cout: 'iostream', cin: 'iostream', cerr: 'iostream', endl: 'iostream',
  setprecision: 'iomanip', setw: 'iomanip', setfill: 'iomanip',
  printf: 'cstdio', scanf: 'cstdio', puts: 'cstdio', putchar: 'cstdio', getchar: 'cstdio',
  sqrt: 'cmath', pow: 'cmath', fabs: 'cmath', floor: 'cmath', ceil: 'cmath', sin: 'cmath', cos: 'cmath', tan: 'cmath', exp: 'cmath', log: 'cmath', log10: 'cmath', round: 'cmath', atan: 'cmath', atan2: 'cmath', fmod: 'cmath', M_PI: 'cmath', hypot: 'cmath',
  rand: 'cstdlib', srand: 'cstdlib', time: 'ctime', strlen: 'cstring', strcpy: 'cstring', strcmp: 'cstring', strcat: 'cstring',
  sort: 'algorithm', reverse: 'algorithm'
};
const INCLUDE_ALIASES = {
  iostream: ['iostream', 'bits/stdc++.h'], iomanip: ['iomanip', 'bits/stdc++.h'],
  cstdio: ['cstdio', 'stdio.h', 'iostream', 'bits/stdc++.h'], cmath: ['cmath', 'math.h', 'bits/stdc++.h', 'iostream'],
  cstdlib: ['cstdlib', 'stdlib.h', 'iostream', 'bits/stdc++.h'], ctime: ['ctime', 'time.h', 'bits/stdc++.h'],
  cstring: ['cstring', 'string.h', 'bits/stdc++.h', 'iostream'], algorithm: ['algorithm', 'bits/stdc++.h', 'vector', 'string']
};

class Gen {
  constructor(ast, includes, warnings, opts) {
    this.ast = ast; this.includes = includes; this.warnings = warnings;
    this.debug = !!(opts && opts.debug); this.typeTab = []; this.typeKeys = new Map();
    this.lines = []; this.ind = 0;
    this.scopes = [new Map()];
    this.funcs = new Map(); // name -> [sig]
    this.structs = new Map();
    this.usingStd = ast.usingStd;
    this.tmp = 0; this.curFn = null; this.warnedInc = new Set();
    this.usedFns = new Set();
  }
  emit(s) { this.lines.push('  '.repeat(this.ind) + s); }
  /* --- débogueur : point d'arrêt possible avant chaque instruction --- */
  mark(line) {
    if (!this.debug || !this.curFn) return '$L=' + line + ';';
    return '$L=' + line + ';if($B.c(' + line + ',()=>[' + this.snapList(1) + ']))await $B.w();';
  }
  snapList(from) {
    const m = new Map();
    for (let i = from; i < (from === 0 ? 1 : this.scopes.length); i++) for (const [n, sy] of this.scopes[i]) m.set(n, sy);
    return [...m].map(([n, sy]) => '[' + JSON.stringify(n) + ',' + this.typeIdx(sy.type) + ',' + (sy.kind === 'ref' ? sy.js + '.v' : sy.js) + ']').join(',');
  }
  typeDesc(t) {
    const d = { n: tname(t), k: t.k };
    if (t.of) d.of = this.typeDesc(t.of);
    if (t.k === 'struct') { const st = this.structs.get(t.name); d.f = st ? st.fields.map(f => [f.name, this.typeDesc(f.type)]) : []; }
    return d;
  }
  typeIdx(t) {
    const d = this.typeDesc(t); const key = JSON.stringify(d);
    if (!this.typeKeys.has(key)) { this.typeKeys.set(key, this.typeTab.length); this.typeTab.push(d); }
    return this.typeKeys.get(key);
  }
  push() { this.scopes.push(new Map()); }
  pop() { this.scopes.pop(); }
  declare(name, sym, line) {
    const sc = this.scopes[this.scopes.length - 1];
    if (sc.has(name)) throw new CErr('« ' + name + ' » est déjà déclaré dans ce bloc', line);
    sym.js = (this.scopes.length === 1 ? 'g_' : 'v_') + name + (this.scopes.length > 1 ? '' : '');
    sc.set(name, sym);
    return sym;
  }
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s; }
    return null;
  }
  needInc(name, line) {
    const lib = NEEDS[name]; if (!lib || this.warnedInc.has(lib)) return;
    const ok = INCLUDE_ALIASES[lib].some(h => this.includes.includes(h));
    if (!ok) { this.warnedInc.add(lib); this.warnings.push({ line, msg: '« ' + name + ' » nécessite #include <' + lib + '>' }); }
  }
  checkStd(node) {
    if (!this.usingStd && !node.std && STD_NAMES.has(node.name)) {
      throw new CErr('« ' + node.name + ' » n\'est pas déclaré : ajoute « using namespace std; » après les #include, ou écris std::' + node.name, node.line);
    }
  }

  /* ----- types ----- */
  resolveType(t, line) {
    if (t.k === 'string' && !t.std && !t.carr && !t.cstr && !this.usingStd) throw new CErr('« string » n\'est pas déclaré : ajoute « using namespace std; » ou écris std::string', line);
    if (t.k === 'vector' && !t.std && !this.usingStd) throw new CErr('« vector » n\'est pas déclaré : ajoute « using namespace std; » ou écris std::vector', line);
    if (t.k === 'vector' && !this.warnedInc.has('vector') && !this.includes.some(h => h === 'vector' || h === 'bits/stdc++.h')) { this.warnedInc.add('vector'); this.warnings.push({ line, msg: 'vector nécessite #include <vector>' }); }
    if (t.k === 'vector' || t.k === 'array') this.resolveType(t.of, line);
    return t;
  }
  zeroOf(t) { // code JS d'une valeur par défaut (expression neuve à chaque évaluation)
    switch (t.k) {
      case 'string': return "''";
      case 'bool': return 'false';
      case 'vector': return '[]';
      case 'struct': return 'mk_' + t.name + '()';
      case 'array': return this.arrayCode(t, null);
      default: return '0';
    }
  }
  arrayDims(t) { const dims = []; let x = t; while (x.k === 'array') { dims.push(x); x = x.of; } return { dims, el: x }; }
  arrayCode(t, list, line) {
    const { dims, el } = this.arrayDims(t);
    const dc = dims.map((d, i) => {
      if (d.dim == null) {
        if (i === 0 && list) return String(list.items.length);
        throw new CErr('Taille du tableau manquante', line);
      }
      const v = this.E(d.dim);
      if (!isIntegral(v.t)) throw new CErr('La taille d\'un tableau doit être un entier', line);
      return v.c;
    });
    const init = list ? this.listLiteral(t, list, line) : 'null';
    return '$rt.arr([' + dc.join(',') + '],' + init + ',()=>' + this.zeroOf(el) + ')';
  }
  listLiteral(t, list, line) {
    if (t.k === 'array' || t.k === 'vector') {
      if (list.k === 'str' && t.k === 'array') throw new CErr('Initialisation invalide', line);
      if (list.k !== 'list') throw new CErr('Liste { ... } attendue pour initialiser ' + tname(t), line);
      return '[' + list.items.map(it => this.initValue(t.of, it, line)).join(',') + ']';
    }
    if (t.k === 'struct') {
      const s = this.structs.get(t.name);
      if (list.k !== 'list') return this.initValue(t, list, line);
      if (list.items.length > s.fields.length) throw new CErr('Trop de valeurs pour initialiser la structure ' + t.name, line);
      const parts = s.fields.map((f, i) => 'f_' + f.name + ':' + (i < list.items.length ? this.initValue(f.type, list.items[i], line) : this.fieldDefault(f)));
      return '{' + parts.join(',') + '}';
    }
    if (list.k === 'list') {
      if (list.items.length === 0) return this.zeroOf(t);
      if (list.items.length > 1) throw new CErr('Trop de valeurs entre { } pour un ' + tname(t), line);
      return this.initValue(t, list.items[0], line);
    }
    return this.initValue(t, list, line);
  }
  fieldDefault(f) {
    if (f.init) return this.initValue(f.type, f.init, f.line);
    return this.zeroOf(f.type);
  }
  initValue(t, node, line) {
    if (node.k === 'list') return this.listLiteral(t, node, line);
    const v = this.E(node);
    return this.conv(t, v, line, node);
  }

  conv(to, v, line, node) {
    const f = v.t, k = to.k;
    if (k === 'auto') return v.c;
    if (isArith(to)) {
      if (!isArith(f)) throw new CErr('Impossible de convertir ' + tname(f) + ' en ' + tname(to) + (f.k === 'string' ? ' (utilise stoi / stod)' : ''), line);
      if (isFloat(to) && node && this.isIntDiv(node)) this.warnings.push({ line, msg: 'Division entière : les deux opérandes sont entiers, le résultat est tronqué avant d\'être converti en ' + to.k + ' (écris par ex. 1.0 / 3)' });
      if (f.k === k && k !== 'char') return v.c;
      switch (k) {
        case 'int': case 'short': case 'char':
          if (f.k === 'bool') return '(' + v.c + '?1:0)';
          if (RANK[f.k] <= 3) return v.c;
          return '(' + v.c + '|0)';
        case 'uint': if (f.k === 'bool') return '(' + v.c + '?1:0)'; return '(' + v.c + '>>>0)';
        case 'long': if (f.k === 'bool') return '(' + v.c + '?1:0)'; if (isFloat(f)) return 'Math.trunc(' + v.c + ')'; return v.c;
        case 'float': if (f.k === 'bool') return '(' + v.c + '?1:0)'; return 'Math.fround(' + v.c + ')';
        case 'double': if (f.k === 'bool') return '(' + v.c + '?1:0)'; return v.c;
        case 'bool': return '!!(' + v.c + ')';
      }
    }
    if (k === 'string') {
      if (f.k === 'string') return v.c;
      if (f.k === 'char') return 'String.fromCharCode(' + v.c + ')';
      throw new CErr('Impossible de convertir ' + tname(f) + ' en string' + (isArith(f) ? ' (utilise to_string)' : ''), line);
    }
    if (k === 'vector' || k === 'struct' || k === 'array') {
      if (f.k !== k || tname(f) !== tname(to)) throw new CErr('Types incompatibles : ' + tname(f) + ' au lieu de ' + tname(to), line);
      return '$rt.clone(' + v.c + ')';
    }
    if (k === 'void') return v.c;
    throw new CErr('Conversion impossible vers ' + tname(to), line);
  }
  isIntDiv(n) {
    while (n.k === 'paren') n = n.e;
    if (n.k === 'bin' && n.op === '/') {
      try { const l = this.typeOnly(n.l), r = this.typeOnly(n.r); return isIntegral(l) && isIntegral(r); } catch (e) { return false; }
    }
    return false;
  }
  typeOnly(n) { const saveW = this.warnings.length; const v = this.E(n); this.warnings.length = saveW; return v.t; }

  /* ----- programme ----- */
  gen() {
    const items = [];
    for (const it of this.ast.items) { if (it.k === 'multi') items.push(...it.list); else items.push(it); }
    // pré-passe : structures et signatures
    for (const it of items) {
      if (it.k === 'struct') this.genStruct(it);
      if (it.k === 'func' || it.k === 'proto') this.registerFunc(it);
    }
    const main = this.funcs.get('main');
    if (!main || !main.some(s => s.defined)) throw new CErr('Pas de fonction main() : le programme commence toujours par int main()', 1);
    for (const it of items) {
      if (it.k === 'decl') this.genDecl(it, true);
    }
    if (this.debug) this.emit('$B.g=()=>[' + this.snapList(0) + '];');
    for (const it of items) if (it.k === 'func') this.genFunc(it);
    // vérifier les prototypes sans définition utilisés
    for (const [name, sigs] of this.funcs) for (const s of sigs) if (!s.defined && this.usedFns.has(s.js)) throw new CErr('La fonction « ' + name + ' » est déclarée (prototype) mais jamais définie', s.line);
    const m = main.find(s => s.defined);
    if (m.ret.k === 'void') this.warnings.push({ line: m.line, msg: 'main doit retourner int : écris « int main() »' });
    const args = m.params.length >= 2 ? '1,["programme"]' : '';
    this.emit('return await ' + m.js + '(' + args + ');');
    if (this.debug) this.lines.unshift('$B.T=' + JSON.stringify(this.typeTab) + ';');
    return this.lines.join('\n');
  }

  genStruct(s) {
    for (const f of s.fields) this.resolveType(f.type, f.line);
    this.structs.set(s.name, s);
    const parts = s.fields.map(f => 'f_' + f.name + ':' + this.fieldDefault(f));
    this.emit('function mk_' + s.name + '(){return {' + parts.join(',') + '};}');
  }

  registerFunc(f) {
    let sigs = this.funcs.get(f.name);
    if (!sigs) { sigs = []; this.funcs.set(f.name, sigs); }
    const n = f.params.length;
    let s = sigs.find(x => x.params.length === n);
    if (s) {
      const same = s.params.every((p, i) => tname(p.type) === tname(f.params[i].type));
      if (!same) throw new CErr('Surcharge de « ' + f.name + ' » avec le même nombre de paramètres : non supporté ici, renomme une des fonctions', f.line);
      if (f.k === 'func') {
        if (s.defined) throw new CErr('La fonction « ' + f.name + ' » est définie deux fois', f.line);
        s.defined = true; s.params = f.params.map((p, i) => Object.assign({}, p, { def: p.def || s.params[i].def }));
      }
      return;
    }
    for (const p of f.params) this.resolveType(p.type, p.line);
    this.resolveType(f.ret, f.line);
    s = { name: f.name, ret: f.ret, params: f.params, js: 'f_' + f.name + '_' + n, defined: f.k === 'func', line: f.line };
    sigs.push(s);
  }

  genFunc(f) {
    const sig = this.funcs.get(f.name).find(s => s.params.length === f.params.length);
    this.curFn = sig;
    this.push();
    const pnames = [];
    for (const p of f.params) {
      if (!p.name) { pnames.push('_u' + (this.tmp++)); continue; }
      let kind = 'var';
      if (p.ref && !isAgg(p.type)) kind = 'ref';
      const sym = this.declare(p.name, { type: p.type, kind, cst: !!p.type.cst }, p.line);
      pnames.push(sym.js);
    }
    this.emit('async function ' + sig.js + '(' + pnames.join(',') + '){');
    this.ind++;
    this.emit('if(++$D>4000)$rt.stack();' + (this.debug ? '$B.in(' + JSON.stringify(f.name) + ');' : ''));
    this.emit('try{');
    this.ind++;
    for (const st of f.body.body) this.S(st);
    if (f.ret.k !== 'void') this.emit('return ' + (f.name === 'main' ? '0' : this.zeroOf(f.ret)) + ';');
    this.ind--;
    this.emit('}finally{$D--;' + (this.debug ? '$B.out();' : '') + '}');
    this.ind--;
    this.emit('}');
    this.pop();
    this.curFn = null;
  }

  /* ----- déclarations ----- */
  genDecl(d, global) {
    let firstMark = true;
    for (const dc of d.decls) {
      let t = this.resolveType(dc.type, dc.line);
      const line = dc.line;
      const mk = firstMark ? this.mark(line) : '$L=' + line + ';'; firstMark = false;
      if (t.k === 'void') throw new CErr('Une variable ne peut pas être de type void', line);
      if (dc.ref) {
        if (!dc.init) throw new CErr('Une référence doit être initialisée : int &r = x;', line);
        if (isAgg(t)) {
          const v = this.E(dc.init);
          const sym = this.declare(dc.name, { type: t, kind: 'var', cst: !!t.cst }, line);
          this.emit(mk + 'let ' + sym.js + '=' + v.c + ';');
        } else {
          const acc = this.refAccessor(dc.init, t, line);
          const sym = this.declare(dc.name, { type: t, kind: 'ref', cst: !!t.cst }, line);
          this.emit(mk + 'let ' + sym.js + '=' + acc + ';');
        }
        continue;
      }
      let code;
      if (t.k === 'auto') {
        if (!dc.init) throw new CErr('auto nécessite une initialisation', line);
        const v = this.E(dc.init);
        t = Object.assign({}, v.t); if (dc.type.cst) t.cst = true;
        code = isAgg(t) ? '$rt.clone(' + v.c + ')' : v.c;
      } else if (t.k === 'array') {
        if (dc.init && dc.init.k !== 'list') throw new CErr('Un tableau s\'initialise avec une liste { ... }', line);
        if (t.dim == null && dc.init) t.dim = { k: 'num', v: dc.init.items.length, nt: 'int' };
        code = this.arrayCode(t, dc.init, line);
      } else if (t.k === 'string' && t.carr) {
        if (t.dim == null && dc.init && dc.init.k === 'str') t.dim = { k: 'num', v: dc.init.v.length + 1, nt: 'int' };
        code = dc.init ? this.initValue(T('string'), dc.init, line) : "''";
      } else if (dc.ctor) {
        code = this.ctorCode(t, dc.ctor, line);
      } else if (dc.init) {
        code = this.initValue(t, dc.init, line);
      } else {
        code = this.zeroOf(t);
        if (t.cst) throw new CErr('Une constante doit être initialisée', line);
      }
      const sym = this.declare(dc.name, { type: t, kind: 'var', cst: !!t.cst, uninit: !dc.init && !dc.ctor && isArith(t) }, line);
      this.emit(mk + 'let ' + sym.js + '=' + code + ';');
    }
  }
  ctorCode(t, args, line) {
    if (t.k === 'vector') {
      if (args.length === 0) return '[]';
      const n = this.E(args[0]);
      if (!isIntegral(n.t)) {
        throw new CErr('vector(n) : n doit être un entier', line);
      }
      const init = args.length > 1 ? this.initValue(t.of, args[1], line) : this.zeroOf(t.of);
      return '$rt.vec(' + n.c + ',()=>' + init + ')';
    }
    if (t.k === 'string') {
      if (args.length === 0) return "''";
      if (args.length === 1) return this.conv(t, this.E(args[0]), line);
      const n = this.E(args[0]), c = this.E(args[1]);
      return '$rt.rep(' + n.c + ',' + c.c + ')';
    }
    if (t.k === 'struct') {
      return this.listLiteral(t, { k: 'list', items: args, line }, line);
    }
    if (args.length !== 1) throw new CErr('Initialisation invalide pour ' + tname(t), line);
    return this.conv(t, this.E(args[0]), line, args[0]);
  }
  refAccessor(node, t, line) {
    let n = node; while (n.k === 'paren') n = n.e;
    if (n.k === 'id') { const s = this.lookup(n.name); if (s && s.kind === 'ref') return s.js; }
    const lv = this.LV(node);
    if (lv.str) {
      throw new CErr('Impossible de passer un caractère de chaîne par référence', line);
    }
    return '{get v(){return ' + lv.c + '},set v($v){' + lv.c + '=$v}}';
  }

  /* ----- instructions ----- */
  tick() { return 'if(++$T>20000){$T=0;$rt.tick();}'; }
  S(st) {
    switch (st.k) {
      case 'block': this.emit('{'); this.ind++; this.push(); for (const s of st.body) this.S(s); this.pop(); this.ind--; this.emit('}'); return;
      case 'empty': if (st.usingStd) this.usingStd = true; return;
      case 'decl': this.genDecl(st, false); return;
      case 'expr': { const mk = this.mark(st.line); this.emit(mk + this.Estmt(st.e) + ';'); return; }
      case 'if': {
        this.checkAssignCond(st.c);
        this.emit(this.mark(st.line) + 'if(' + this.cond(st.c) + ')'); this.body(st.a);
        if (st.b) { this.emit('else'); this.body(st.b); }
        return;
      }
      case 'while':
        this.checkAssignCond(st.c);
        this.emit(this.mark(st.line) + 'while(' + this.cond(st.c) + '){'); this.ind++; this.emit(this.tick()); this.inner(st.body); this.ind--; this.emit('}'); return;
      case 'do':
        this.emit('do{'); this.ind++; this.emit(this.tick()); this.inner(st.body); this.ind--;
        this.emit(this.mark(st.line) + '}while(' + this.cond(st.c) + ');'); return;
      case 'for': {
        this.emit('{'); this.ind++; this.push();
        if (st.init) this.S(st.init);
        const c = st.c ? this.cond(st.c) : 'true';
        const step = st.step ? this.Estmt(st.step) : '';
        this.emit('$L=' + st.line + ';for(;' + c + ';' + step + '){'); this.ind++; this.emit(this.tick()); if (this.debug) this.emit(this.mark(st.line)); this.inner(st.body); this.ind--; this.emit('}');
        this.pop(); this.ind--; this.emit('}');
        return;
      }
      case 'rangefor': {
        const coll = this.E(st.coll);
        let elT;
        if (coll.t.k === 'vector' || coll.t.k === 'array') elT = coll.t.of;
        else if (coll.t.k === 'string') elT = T('char');
        else throw new CErr('Boucle for (x : ...) possible seulement sur un tableau, un vector ou une string', st.line);
        let t = st.type.k === 'auto' ? elT : this.resolveType(st.type, st.line);
        const k = '$k' + (this.tmp++), a = '$a' + (this.tmp++);
        this.emit('{'); this.ind++; this.push();
        this.emit('let ' + a + '=' + coll.c + ';');
        this.emit('$L=' + st.line + ';for(let ' + k + '=0;' + k + '<' + a + '.length;' + k + '++){'); this.ind++;
        const rfLine = st.line;
        this.emit(this.tick());
        if (coll.t.k === 'string') {
          const sym = this.declare(st.name, { type: T('char'), kind: 'var' }, st.line);
          this.emit('let ' + sym.js + '=' + a + '.charCodeAt(' + k + ');');
        } else if (st.ref && !isAgg(t)) {
          const sym = this.declare(st.name, { type: t, kind: 'ref', cst: !!st.type.cst }, st.line);
          this.emit('let ' + sym.js + '={get v(){return ' + a + '[' + k + ']},set v($v){' + a + '[' + k + ']=$v}};');
        } else {
          const sym = this.declare(st.name, { type: t, kind: 'var', cst: !!st.type.cst }, st.line);
          const val = st.ref ? a + '[' + k + ']' : this.conv(t, { c: a + '[' + k + ']', t: elT }, st.line);
          this.emit('let ' + sym.js + '=' + val + ';');
        }
        if (this.debug) this.emit(this.mark(rfLine));
        this.inner(st.body);
        this.ind--; this.emit('}');
        this.pop(); this.ind--; this.emit('}');
        return;
      }
      case 'switch': {
        const e = this.E(st.e);
        if (!isIntegral(e.t)) throw new CErr('switch fonctionne seulement sur un entier ou un char', st.line);
        this.emit(this.mark(st.line) + 'switch(' + e.c + '){'); this.ind++;
        const seen = new Set();
        for (const cs of st.cases) {
          if (cs.test) {
            const v = this.E(cs.test);
            if (seen.has(v.c)) throw new CErr('Valeur de case en double : ' + v.c, cs.line || st.line);
            seen.add(v.c);
            this.emit('case ' + v.c + ':{');
          } else this.emit('default:{');
          this.ind++; this.push(); for (const s of cs.body) this.S(s); this.pop(); this.ind--;
          this.emit('}');
        }
        this.ind--; this.emit('}');
        return;
      }
      case 'break': this.emit('break;'); return;
      case 'continue': this.emit('continue;'); return;
      case 'return': {
        const fn = this.curFn;
        if (!st.e) {
          if (fn.ret.k !== 'void') throw new CErr('La fonction ' + fn.name + ' doit retourner une valeur de type ' + tname(fn.ret), st.line);
          this.emit(this.mark(st.line) + 'return;'); return;
        }
        if (fn.ret.k === 'void') throw new CErr('La fonction ' + fn.name + ' est void : elle ne retourne pas de valeur', st.line);
        const mk = this.mark(st.line);
        this.emit(mk + 'return ' + this.initValue(fn.ret, st.e, st.line) + ';');
        return;
      }
      default: throw new CErr('Instruction non supportée : ' + st.k, st.line);
    }
  }
  body(st) { this.emit('{'); this.ind++; this.inner(st); this.ind--; this.emit('}'); }
  inner(st) { if (st.k === 'block') { this.push(); for (const s of st.body) this.S(s); this.pop(); } else { this.push(); this.S(st); this.pop(); } }
  checkAssignCond(c) {
    if (c.k === 'assign' && c.op === '=') this.warnings.push({ line: c.line, msg: 'Affectation « = » dans une condition : voulais-tu écrire « == » ?' });
  }
  cond(e) {
    const v = this.E(e);
    if (!isArith(v.t)) throw new CErr('Condition invalide : une valeur de type ' + tname(v.t) + ' n\'est pas un booléen', e.line);
    return v.c;
  }

  /* ----- expressions ----- */
  Estmt(e) { // expression en position d'instruction
    const ch = this.streamChain(e);
    if (ch) return ch.stmt;
    return this.E(e).c;
  }
  lit(t, c) { return { c, t: T(t) }; }

  E(e) {
    switch (e.k) {
      case 'num': {
        if (e.nt === 'float') return this.lit('float', String(Math.fround(e.v)));
        if (e.nt === 'double') { let s = String(e.v); return this.lit('double', s); }
        return this.lit(e.nt, String(e.v));
      }
      case 'str': return { c: JSON.stringify(e.v), t: { k: 'string', lit: true } };
      case 'chr': return this.lit('char', String(e.v));
      case 'bool': return this.lit('bool', e.v ? 'true' : 'false');
      case 'paren': { const v = this.E(e.e); return { c: '(' + v.c + ')', t: v.t }; }
      case 'list': throw new CErr('Liste { ... } inattendue ici', e.line);
      case 'limits': {
        const k = e.type.k, w = e.what;
        const tab = {
          int: { max: '2147483647', min: '-2147483648' }, short: { max: '32767', min: '-32768' }, char: { max: '127', min: '-128' },
          uint: { max: '4294967295', min: '0' }, long: { max: '9223372036854775807', min: '-9223372036854775808' },
          double: { max: '1.7976931348623157e308', min: '2.2250738585072014e-308', lowest: '-1.7976931348623157e308', epsilon: '2.220446049250313e-16' },
          float: { max: '3.4028234663852886e38', min: '1.1754943508222875e-38', lowest: '-3.4028234663852886e38', epsilon: '1.1920928955078125e-7' }
        };
        const kk = (e.type.k === 'long' ? 'long' : k);
        const v = (tab[kk] || {})[w] || (w === 'max' ? '9007199254740991' : null);
        if (v == null) throw new CErr('numeric_limits<' + tname(e.type) + '>::' + w + ' non supporté', e.line);
        return { c: v, t: e.type.k === 'long' || !tab[kk] ? T('long') : T(kk) };
      }
      case 'sizeof': {
        let t = e.type;
        if (!t) { t = this.E(e.e).t; }
        const sz = t2 => { if (t2.k === 'array') { const n = this.E(t2.dim); return '(' + n.c + ')*' + sz(t2.of); } if (t2.k === 'struct') { return String(this.structs.get(t2.name).fields.reduce((a, f) => a + (SIZEOF[f.type.k] || 8), 0)); } return String(SIZEOF[t2.k] || 8); };
        if (t.k === 'string' && t.carr && t.dim) { const n = this.E(t.dim); return { c: '(' + n.c + ')', t: T('long') }; }
        return { c: '(' + sz(t) + ')', t: T('long') };
      }
      case 'id': return this.Eid(e);
      case 'cast': {
        const t = this.resolveType(e.type, e.line); const v = this.E(e.e);
        if (t.k === 'string') return { c: this.conv(t, v, e.line), t };
        if (!isArith(t)) throw new CErr('Conversion vers ' + tname(t) + ' non supportée', e.line);
        if (!isArith(v.t)) throw new CErr('Impossible de convertir ' + tname(v.t) + ' en ' + tname(t), e.line);
        return { c: '(' + this.conv(t, v, e.line) + ')', t };
      }
      case 'ctor': {
        const t = this.resolveType(e.type, e.line);
        return { c: this.ctorCode(t, e.args, e.line), t };
      }
      case 'un': {
        const v = this.E(e.e);
        if (e.op === '!') { if (!isArith(v.t)) throw new CErr('! s\'applique à une valeur booléenne', e.line); return this.lit('bool', '!(' + v.c + ')'); }
        if (!isArith(v.t)) throw new CErr('L\'opérateur ' + e.op + ' ne s\'applique pas à ' + tname(v.t), e.line);
        const r = arith(v.t, T('int'));
        if (e.op === '~') { if (!isIntegral(v.t)) throw new CErr('~ s\'applique aux entiers', e.line); return { c: '(~' + v.c + ')', t: r }; }
        if (e.op === '+') return { c: '(+' + v.c + ')', t: r };
        return { c: this.wrapArith(r, '(-' + v.c + ')'), t: r };
      }
      case 'pre': case 'post': {
        const lv = this.LV(e.e);
        if (lv.str) throw new CErr('++/-- sur un caractère de chaîne non supporté', e.line);
        if (!isArith(lv.t) || lv.t.k === 'bool') throw new CErr(e.op + ' s\'applique à une variable numérique', e.line);
        let c = e.k === 'pre' ? e.op + lv.c : lv.c + e.op;
        if (lv.t.k === 'int' || lv.t.k === 'uint' || lv.t.k === 'short' || lv.t.k === 'char') {
          const w = lv.t.k === 'uint' ? '>>>0' : lv.t.k === 'short' ? '<<16>>16' : '|0';
          const nv = '(' + lv.c + (e.op === '++' ? '+1' : '-1') + ')' + w;
          c = e.k === 'pre' ? '(' + lv.c + '=' + nv + ')' : '$rt.postf(' + lv.c + ',' + lv.c + '=' + nv + ')';
        }
        if (lv.t.k === 'float') c = e.k === 'pre' ? '(' + lv.c + '=Math.fround(' + lv.c + (e.op === '++' ? '+1' : '-1') + '))' : '$rt.postf(' + lv.c + ',' + lv.c + '=Math.fround(' + lv.c + (e.op === '++' ? '+1' : '-1') + '))';
        return { c: '(' + c + ')', t: lv.t };
      }
      case 'addr': throw new CErr('L\'opérateur & (adresse) n\'est utilisable que dans scanf(..., &x)', e.line);
      case 'comma': { const a = this.Estmt(e.a); const b = this.E(e.b); return { c: '(' + a + ',' + b.c + ')', t: b.t }; }
      case 'cond': {
        const c = this.cond(e.c); const a = this.E(e.a), b = this.E(e.b);
        let t = a.t;
        if (isArith(a.t) && isArith(b.t)) { t = (a.t.k === b.t.k) ? a.t : arith(a.t, b.t); return { c: '(' + c + '?' + this.conv(t, a, e.line) + ':' + this.conv(t, b, e.line) + ')', t }; }
        if (a.t.k === 'string' || b.t.k === 'string') { t = T('string'); return { c: '(' + c + '?' + this.conv(t, a, e.line) + ':' + this.conv(t, b, e.line) + ')', t }; }
        return { c: '(' + c + '?' + a.c + ':' + b.c + ')', t };
      }
      case 'assign': return this.Eassign(e);
      case 'bin': return this.Ebin(e);
      case 'index': {
        const b = this.E(e.e); const i = this.E(e.i);
        if (!isIntegral(i.t)) throw new CErr('L\'indice d\'un tableau doit être un entier (ici ' + tname(i.t) + ')', e.line);
        if (b.t.k === 'string') return { c: '$rt.ch(' + b.c + ',' + i.c + ')', t: T('char') };
        if (b.t.k === 'array' || b.t.k === 'vector') return { c: b.c + '[$rt.ck(' + b.c + ',' + i.c + ')]', t: b.t.of };
        throw new CErr('[] s\'applique à un tableau, un vector ou une string (pas à ' + tname(b.t) + ')', e.line);
      }
      case 'member': {
        const b = this.E(e.e);
        if (b.t.k !== 'struct') throw new CErr('« .' + e.name + ' » : ' + (b.t.k === 'string' || b.t.k === 'vector' ? 'il manque les parenthèses ? ex : .' + e.name + '()' : tname(b.t) + ' n\'est pas une structure'), e.line);
        const s = this.structs.get(b.t.name); const f = s.fields.find(x => x.name === e.name);
        if (!f) throw new CErr('La structure ' + s.name + ' n\'a pas de champ « ' + e.name + ' »', e.line);
        return { c: b.c + '.f_' + e.name, t: f.type };
      }
      case 'call': return this.Ecall(e);
    }
    throw new CErr('Expression non supportée (' + e.k + ')', e.line);
  }

  Eid(e) {
    const s = this.lookup(e.name);
    if (s) {
      if (s.kind === 'ref') return { c: s.js + '.v', t: s.type };
      return { c: s.js, t: s.type };
    }
    this.checkStd(e);
    this.needInc(e.name, e.line);
    switch (e.name) {
      case 'M_PI': return this.lit('double', String(Math.PI));
      case 'M_E': return this.lit('double', String(Math.E));
      case 'INT_MAX': return this.lit('int', '2147483647');
      case 'INT_MIN': return this.lit('int', '-2147483648');
      case 'RAND_MAX': return this.lit('int', '2147483647');
      case 'EOF': return this.lit('int', '-1');
      case 'EXIT_SUCCESS': return this.lit('int', '0');
      case 'EXIT_FAILURE': return this.lit('int', '1');
      case 'cout': case 'cin': case 'cerr': case 'clog':
        throw new CErr('« ' + e.name + ' » s\'utilise avec ' + (e.name === 'cin' ? '>>' : '<<'), e.line);
      case 'endl': throw new CErr('endl s\'utilise dans un cout << ... << endl', e.line);
    }
    if (this.funcs.has(e.name)) throw new CErr('« ' + e.name + ' » est une fonction : il manque les parenthèses ( )', e.line);
    throw new CErr('« ' + e.name + ' » n\'est pas déclaré dans cette portée', e.line);
  }

  wrapArith(r, c) {
    switch (r.k) {
      case 'int': return '(' + c + '|0)';
      case 'uint': return '(' + c + '>>>0)';
      case 'float': return 'Math.fround(' + c + ')';
      default: return c;
    }
  }

  Ebin(e) {
    const ch = this.streamChain(e);
    if (ch) return { c: ch.expr, t: T('bool') };
    const op = e.op;
    const a = this.E(e.l), b = this.E(e.r);
    if (op === '&&' || op === '||') {
      if (!isArith(a.t) || !isArith(b.t)) throw new CErr(op + ' s\'applique à des conditions', e.line);
      return this.lit('bool', '(' + a.c + op + b.c + ')');
    }
    const strA = a.t.k === 'string', strB = b.t.k === 'string';
    if (strA || strB) {
      if (op === '+') {
        if (strA && strB && a.t.lit && b.t.lit) throw new CErr('Impossible d\'additionner deux littéraux "..." + "..." : utilise string("...") + "..."', e.line);
        const sa = strA ? a.c : (a.t.k === 'char' ? 'String.fromCharCode(' + a.c + ')' : null);
        const sb = strB ? b.c : (b.t.k === 'char' ? 'String.fromCharCode(' + b.c + ')' : null);
        if (sa == null || sb == null) throw new CErr('Impossible d\'additionner une string et un ' + tname(strA ? b.t : a.t) + ' : utilise to_string(nombre)', e.line);
        return { c: '(' + sa + '+' + sb + ')', t: T('string') };
      }
      if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
        if (!(strA && strB)) {
          if ((strA && b.t.k === 'char') || (strB && a.t.k === 'char')) throw new CErr('Comparaison entre une string et un char : utilise "x" (guillemets) au lieu de \'x\'', e.line);
          throw new CErr('Comparaison impossible entre ' + tname(a.t) + ' et ' + tname(b.t), e.line);
        }
        return this.lit('bool', '(' + a.c + (op === '==' ? '===' : op === '!=' ? '!==' : op) + b.c + ')');
      }
      throw new CErr('L\'opérateur ' + op + ' ne s\'applique pas aux chaînes', e.line);
    }
    if (!isArith(a.t) || !isArith(b.t)) throw new CErr('L\'opérateur ' + op + ' ne s\'applique pas à ' + tname(!isArith(a.t) ? a.t : b.t), e.line);
    if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
      const jo = op === '==' ? '==' : op === '!=' ? '!=' : op;
      // bool vs nombre : on compare des nombres
      const ca = a.t.k === 'bool' ? '(+' + a.c + ')' : a.c, cb = b.t.k === 'bool' ? '(+' + b.c + ')' : b.c;
      return this.lit('bool', '(' + ca + jo + cb + ')');
    }
    const r = arith(a.t, b.t);
    const intOp = isIntegral(r);
    switch (op) {
      case '+': case '-': return { c: this.wrapArith(r, '(' + a.c + op + b.c + ')'), t: r };
      case '*':
        if (r.k === 'int') return { c: 'Math.imul(' + a.c + ',' + b.c + ')', t: r };
        if (r.k === 'uint') return { c: '(Math.imul(' + a.c + ',' + b.c + ')>>>0)', t: r };
        return { c: this.wrapArith(r, '(' + a.c + '*' + b.c + ')'), t: r };
      case '/':
        if (intOp) return { c: (r.k === 'long' ? '$rt.ldiv(' : r.k === 'uint' ? '$rt.udiv(' : '$rt.idiv(') + a.c + ',' + b.c + ')', t: r };
        return { c: this.wrapArith(r, '(' + a.c + '/' + b.c + ')'), t: r };
      case '%':
        if (!intOp) throw new CErr('L\'opérateur % ne s\'applique qu\'aux entiers (pour des réels, utilise fmod)', e.line);
        return { c: '$rt.imod(' + a.c + ',' + b.c + ')', t: r };
      case '&': case '|': case '^': case '<<': case '>>':
        if (!intOp) throw new CErr('L\'opérateur ' + op + ' ne s\'applique qu\'aux entiers', e.line);
        if (r.k === 'long' && (op === '<<' || op === '>>')) return { c: op === '<<' ? '(' + a.c + '*Math.pow(2,' + b.c + '))' : 'Math.floor(' + a.c + '/Math.pow(2,' + b.c + '))', t: r };
        return { c: '(' + a.c + op + b.c + ')', t: r.k === 'long' ? T('int') : r };
    }
    throw new CErr('Opérateur ' + op + ' non supporté', e.line);
  }

  LV(node) {
    let n = node; while (n.k === 'paren') n = n.e;
    if (n.k === 'id') {
      const s = this.lookup(n.name);
      if (!s) { this.Eid(n); }
      if (s.cst) throw new CErr('« ' + n.name + ' » est constant (const) : on ne peut pas le modifier', n.line);
      if (s.type.k === 'array') throw new CErr('On ne peut pas affecter un tableau entier : copie-le case par case', n.line);
      return { c: s.kind === 'ref' ? s.js + '.v' : s.js, t: s.type };
    }
    if (n.k === 'index') {
      const b = this.E(n.e); const i = this.E(n.i);
      if (!isIntegral(i.t)) throw new CErr('L\'indice d\'un tableau doit être un entier', n.line);
      if (b.t.k === 'string') { const base = this.LV(n.e); return { str: true, base: base.c, idx: i.c, t: T('char') }; }
      if (b.t.k === 'array' || b.t.k === 'vector') {
        if (b.t.of.k === 'array') throw new CErr('On ne peut pas affecter une ligne de tableau entière', n.line);
        return { c: b.c + '[$rt.ck(' + b.c + ',' + i.c + ')]', t: b.t.of };
      }
      throw new CErr('[] s\'applique à un tableau, un vector ou une string', n.line);
    }
    if (n.k === 'member') { const v = this.E(n); return { c: v.c, t: v.t }; }
    if (n.k === 'call' && n.f.k === 'member' && n.f.name === 'at') {
      const b = this.E(n.f.e); const i = this.E(n.args[0]);
      if (b.t.k === 'vector') return { c: b.c + '[$rt.ck(' + b.c + ',' + i.c + ')]', t: b.t.of };
    }
    if (n.k === 'call' && n.f.k === 'member' && (n.f.name === 'back' || n.f.name === 'front')) {
      const b = this.E(n.f.e);
      if (b.t.k === 'vector') return { c: b.c + '[$rt.ck(' + b.c + ',' + (n.f.name === 'back' ? b.c + '.length-1' : '0') + ')]', t: b.t.of };
    }
    throw new CErr('Cette expression ne peut pas être modifiée (il faut une variable à gauche du =)', n.line);
  }

  Eassign(e) {
    const lv = this.LV(e.l);
    const t = lv.t;
    if (lv.str) {
      if (e.op !== '=') throw new CErr('Opérateur ' + e.op + ' sur un caractère de chaîne non supporté', e.line);
      const v = this.E(e.r);
      return { c: '(' + lv.base + '=$rt.setch(' + lv.base + ',' + lv.idx + ',' + this.conv(T('char'), v, e.line) + '))', t: T('char') };
    }
    if (e.op === '=') {
      if (t.k === 'vector') {
        const v = e.r.k === 'list' ? { c: this.listLiteral(t, e.r, e.line), t } : this.E(e.r);
        if (tname(v.t) !== tname(t)) throw new CErr('Types incompatibles : ' + tname(v.t) + ' au lieu de ' + tname(t), e.line);
        return { c: '$rt.vset(' + lv.c + ',' + v.c + ')', t };
      }
      if (t.k === 'struct') {
        const v = e.r.k === 'list' ? { c: this.listLiteral(t, e.r, e.line), t } : this.E(e.r);
        if (tname(v.t) !== tname(t)) throw new CErr('Types incompatibles : ' + tname(v.t) + ' au lieu de ' + tname(t), e.line);
        return { c: '$rt.sset(' + lv.c + ',' + v.c + ')', t };
      }
      const code = this.initValue(t, e.r, e.line);
      return { c: '(' + lv.c + '=' + code + ')', t };
    }
    const op = e.op.slice(0, -1);
    if (t.k === 'string') {
      if (op !== '+') throw new CErr('Opérateur ' + e.op + ' non supporté sur les chaînes', e.line);
      const v = this.E(e.r);
      return { c: '(' + lv.c + '+=' + this.conv(T('string'), v, e.line) + ')', t };
    }
    if (!isArith(t)) throw new CErr('Opérateur ' + e.op + ' non supporté pour ' + tname(t), e.line);
    const bin = this.Ebin({ k: 'bin', op, l: { k: 'raw', c: lv.c, t }, r: e.r, line: e.line });
    return { c: '(' + lv.c + '=' + this.conv(t, bin, e.line) + ')', t };
  }

  /* ----- cout / cin ----- */
  flatten(e, op) { // a << b << c -> [a, b, c]
    const items = [];
    let n = e;
    while (n.k === 'bin' && n.op === op) { items.unshift(n.r); n = n.l; }
    items.unshift(n);
    return items;
  }
  streamChain(e) {
    if (e.k !== 'bin' || (e.op !== '<<' && e.op !== '>>')) return null;
    const items = this.flatten(e, e.op);
    const root = items[0];
    if (root.k === 'call' && root.f.k === 'member' && root.f.e.k === 'id' && root.f.e.name === 'cin' && e.op === '>>') { /* cin.get() >> */ }
    if (root.k !== 'id' || this.lookup(root.name)) return null;
    const nm = root.name;
    if (e.op === '<<' && (nm === 'cout' || nm === 'cerr' || nm === 'clog')) {
      this.checkStd(root); this.needInc('cout', root.line);
      const parts = [];
      const stream = nm === 'cout' ? '$o' : '$e';
      for (const it of items.slice(1)) parts.push(this.outItem(it, stream));
      return { stmt: parts.join(';'), expr: '(' + (parts.length ? parts.join(',') + ',' : '') + 'true)' };
    }
    if (e.op === '>>' && nm === 'cin') {
      this.checkStd(root); this.needInc('cin', root.line);
      const parts = [];
      for (const it of items.slice(1)) parts.push(this.inItem(it));
      return { stmt: parts.join(';'), expr: '(' + parts.join(',') + ',$i.ok())' };
    }
    if (e.op === '>>' && (nm === 'cout' || nm === 'cerr')) throw new CErr('Avec cout on utilise << (et non >>)', e.line);
    if (e.op === '<<' && nm === 'cin') throw new CErr('Avec cin on utilise >> (et non <<)', e.line);
    return null;
  }
  outItem(it, s) {
    if (it.k === 'id' && !this.lookup(it.name) && MANIPS.has(it.name)) {
      this.checkStd(it);
      const m = { endl: 'endl()', flush: 'flush()', fixed: "m('fixed')", scientific: "m('scientific')", defaultfloat: "m('defaultfloat')", left: "m('left')", right: "m('right')",
        boolalpha: "m('boolalpha')", noboolalpha: "m('noboolalpha')", showpoint: "m('showpoint')", noshowpoint: "m('noshowpoint')", showpos: "m('showpos')", noshowpos: "m('noshowpos')",
        uppercase: "m('uppercase')", nouppercase: "m('nouppercase')", hex: "m('hex')", dec: "m('dec')", oct: "m('oct')" }[it.name];
      return s + '.' + m;
    }
    if (it.k === 'call' && it.f.k === 'id' && !this.lookup(it.f.name) && ['setprecision', 'setw', 'setfill'].includes(it.f.name)) {
      this.checkStd(it.f); this.needInc(it.f.name, it.line);
      const v = this.E(it.args[0]);
      return s + '.' + { setprecision: 'prec', setw: 'setw', setfill: 'fill' }[it.f.name] + '(' + v.c + ')';
    }
    const v = this.E(it);
    switch (v.t.k) {
      case 'int': case 'short': case 'uint': case 'long': return s + '.i(' + v.c + ')';
      case 'char': return s + '.c(' + v.c + ')';
      case 'bool': return s + '.b(' + v.c + ')';
      case 'float': case 'double': return s + '.f(' + v.c + ')';
      case 'string': return s + '.s(' + v.c + ')';
      case 'array': throw new CErr('cout ne peut pas afficher un tableau entier : utilise une boucle', it.line);
      case 'vector': throw new CErr('cout ne peut pas afficher un vector entier : utilise une boucle', it.line);
      case 'struct': throw new CErr('cout ne peut pas afficher une structure : affiche ses champs un par un', it.line);
      case 'void': throw new CErr('Impossible d\'afficher le résultat d\'une fonction void', it.line);
    }
    throw new CErr('Affichage impossible', it.line);
  }
  readKind(t) {
    switch (t.k) {
      case 'int': case 'short': case 'uint': case 'long': return "'i'";
      case 'float': case 'double': return "'f'";
      case 'char': return "'c'";
      case 'string': return "'s'";
      case 'bool': return "'b'";
    }
    return null;
  }
  inItem(it) {
    if (it.k === 'id' && it.name === 'ws' && !this.lookup('ws')) return 'await $i.ws()';
    const lv = this.LV(it);
    if (lv.str) throw new CErr('cin >> s[i] non supporté', it.line);
    const k = this.readKind(lv.t);
    if (!k) throw new CErr('cin ne peut pas lire directement un ' + tname(lv.t), it.line);
    return 'await $i.rd(' + k + ',$v=>{' + lv.c + '=' + this.conv(lv.t, { c: '$v', t: lv.t.k === 'string' ? T('string') : lv.t.k === 'char' ? T('char') : lv.t.k === 'bool' ? T('int') : isFloat(lv.t) ? T('double') : T('long') }, it.line) + '})';
  }

  /* ----- appels ----- */
  argsOf(e, n, name) {
    if (n != null && e.args.length !== n) throw new CErr(name + ' attend ' + n + ' argument' + (n > 1 ? 's' : '') + ' (reçu ' + e.args.length + ')', e.line);
    return e.args.map(a => this.E(a));
  }
  num(v, line, name) { if (!isArith(v.t)) throw new CErr(name + ' attend un nombre, pas un ' + tname(v.t), line); return v; }

  Ecall(e) {
    if (e.f.k === 'member') return this.Emethod(e);
    if (e.f.k !== 'id') throw new CErr('Appel de fonction invalide', e.line);
    const name = e.f.name;
    const sym = this.lookup(name);
    if (sym) throw new CErr('« ' + name + ' » est une variable, pas une fonction', e.line);
    const sigs = this.funcs.get(name);
    if (sigs) return this.userCall(e, name, sigs);
    this.checkStd(e.f);
    this.needInc(name, e.line);
    return this.builtin(e, name);
  }
  userCall(e, name, sigs) {
    const n = e.args.length;
    const s = sigs.find(x => x.params.length >= n && x.params.slice(n).every(p => p.def));
    if (!s) {
      const exp = sigs.map(x => x.params.length).join(' ou ');
      throw new CErr('La fonction ' + name + ' attend ' + exp + ' argument(s), mais en reçoit ' + n, e.line);
    }
    this.usedFns.add(s.js);
    const args = s.params.map((p, i) => {
      const a = i < n ? e.args[i] : p.def;
      if (p.ref && !isAgg(p.type)) {
        if (p.type.cst) { // const T& : on peut passer une valeur temporaire
          let nn = a; while (nn.k === 'paren') nn = nn.e;
          const isLv = nn.k === 'id' || nn.k === 'index' || nn.k === 'member';
          if (!isLv) { const v = this.E(a); return '{v:' + this.conv(p.type, v, e.line, a) + '}'; }
        }
        const lv0 = (() => { try { return this.LV(a); } catch (err) { throw new CErr('Le paramètre ' + (i + 1) + ' de ' + name + ' est une référence (&) : il faut passer une variable', e.line); } })();
        if (tname(lv0.t) !== tname(p.type) && !(lv0.t.k === 'string' && p.type.k === 'string')) throw new CErr('Paramètre ' + (i + 1) + ' de ' + name + ' : référence vers ' + tname(p.type) + ' attendue, reçu ' + tname(lv0.t), e.line);
        return this.refAccessor(a, p.type, e.line);
      }
      if (p.type.k === 'array') {
        const v = this.E(a);
        if (v.t.k !== 'array') throw new CErr('Le paramètre ' + (i + 1) + ' de ' + name + ' doit être un tableau', e.line);
        return v.c;
      }
      if (p.ref && isAgg(p.type)) {
        const v = a.k === 'list' ? { c: this.listLiteral(p.type, a, e.line), t: p.type } : this.E(a);
        if (tname(v.t) !== tname(p.type)) throw new CErr('Paramètre ' + (i + 1) + ' de ' + name + ' : ' + tname(p.type) + ' attendu, reçu ' + tname(v.t), e.line);
        return v.c;
      }
      return this.initValue(p.type, a, e.line);
    });
    return { c: '(await ' + s.js + '(' + args.join(',') + '))', t: s.ret };
  }

  builtin(e, name) {
    const L = e.line;
    const M1 = (fn, ret = 'double') => { const [a] = this.argsOf(e, 1, name); this.num(a, L, name); return { c: fn + '(' + a.c + ')', t: T(ret) }; };
    switch (name) {
      case 'sqrt': return M1('Math.sqrt'); case 'sin': return M1('Math.sin'); case 'cos': return M1('Math.cos'); case 'tan': return M1('Math.tan');
      case 'asin': return M1('Math.asin'); case 'acos': return M1('Math.acos'); case 'atan': return M1('Math.atan'); case 'exp': return M1('Math.exp');
      case 'log': return M1('Math.log'); case 'log10': return M1('Math.log10'); case 'log2': return M1('Math.log2'); case 'cbrt': return M1('Math.cbrt');
      case 'floor': return M1('Math.floor'); case 'ceil': return M1('Math.ceil'); case 'trunc': return M1('Math.trunc'); case 'round': return M1('$rt.round');
      case 'fabs': return M1('Math.abs'); case 'sinh': return M1('Math.sinh'); case 'cosh': return M1('Math.cosh'); case 'tanh': return M1('Math.tanh');
      case 'sqrtf': return M1('Math.sqrt', 'float');
      case 'abs': case 'labs': case 'llabs': {
        const [a] = this.argsOf(e, 1, name); this.num(a, L, name);
        const t = isFloat(a.t) ? a.t : arith(a.t, T('int'));
        return { c: this.wrapArith(t, 'Math.abs(' + a.c + ')'), t };
      }
      case 'pow': { const [a, b] = this.argsOf(e, 2, name); this.num(a, L, name); this.num(b, L, name); return { c: 'Math.pow(' + a.c + ',' + b.c + ')', t: T('double') }; }
      case 'atan2': { const [a, b] = this.argsOf(e, 2, name); return { c: 'Math.atan2(' + a.c + ',' + b.c + ')', t: T('double') }; }
      case 'hypot': { const [a, b] = this.argsOf(e, 2, name); return { c: 'Math.hypot(' + a.c + ',' + b.c + ')', t: T('double') }; }
      case 'fmod': { const [a, b] = this.argsOf(e, 2, name); return { c: '(' + a.c + '%' + b.c + ')', t: T('double') }; }
      case 'min': case 'max': case 'fmin': case 'fmax': {
        const [a, b] = this.argsOf(e, 2, name);
        if (a.t.k === 'string' && b.t.k === 'string') return { c: '$rt.' + name.replace('f', '') + 's(' + a.c + ',' + b.c + ')', t: a.t };
        this.num(a, L, name); this.num(b, L, name);
        if (name[0] !== 'f' && a.t.k !== b.t.k && !(a.t.k in { int: 1, short: 1, char: 1 } && b.t.k in { int: 1, short: 1, char: 1 })) {
          throw new CErr(name + '(a, b) : les deux arguments doivent avoir le même type (ici ' + tname(a.t) + ' et ' + tname(b.t) + ')', L);
        }
        const t = name[0] === 'f' ? T('double') : (a.t.k === b.t.k ? a.t : arith(a.t, b.t));
        return { c: 'Math.' + name.replace(/^f/, '') + '(' + a.c + ',' + b.c + ')', t };
      }
      case 'rand': this.argsOf(e, 0, name); return { c: '$rt.rand()', t: T('int') };
      case 'srand': { const [a] = this.argsOf(e, 1, name); return { c: '$rt.srand(' + a.c + ')', t: T('void') }; }
      case 'time': return { c: 'Math.floor(Date.now()/1000)', t: T('long') };
      case 'clock': return { c: '$rt.clock()', t: T('long') };
      case 'exit': { const [a] = this.argsOf(e, 1, name); return { c: '$rt.exit(' + a.c + ')', t: T('void') }; }
      case 'system': {
        const [a] = this.argsOf(e, 1, name);
        return { c: '$rt.system(' + a.c + ')', t: T('int') };
      }
      case 'SetConsoleOutputCP': case 'SetConsoleCP': case 'setlocale': case 'Sleep': case 'usleep': case 'sleep':
        return { c: '0', t: T('int') };
      case 'printf': {
        if (!e.args.length) throw new CErr('printf attend au moins un format', L);
        const args = e.args.map(a => this.E(a));
        if (args[0].t.k !== 'string') throw new CErr('Le premier argument de printf doit être une chaîne "..."', L);
        for (const a of args.slice(1)) if (!isArith(a.t) && a.t.k !== 'string') throw new CErr('printf ne peut pas afficher un ' + tname(a.t), L);
        if (e.args[0].k === 'str') this.checkPrintf(e.args[0].v, args.slice(1), L);
        return { c: '$o.printf(' + args[0].c + ',[' + args.slice(1).map(a => a.c).join(',') + '])', t: T('int') };
      }
      case 'puts': { const [a] = this.argsOf(e, 1, name); return { c: '($o.s(' + a.c + '),$o.c(10),0)', t: T('int') }; }
      case 'putchar': { const [a] = this.argsOf(e, 1, name); return { c: '($o.c(' + a.c + '),' + a.c + ')', t: T('int') }; }
      case 'getchar': this.argsOf(e, 0, name); return { c: '(await $i.getchar())', t: T('int') };
      case 'scanf': {
        if (!e.args.length || e.args[0].k !== 'str') throw new CErr('scanf attend un format "..." en premier argument', L);
        const sets = e.args.slice(1).map((a, i) => {
          let target = a;
          if (a.k === 'addr') target = a.e;
          else {
            const v = this.E(a);
            if (!(v.t.k === 'string')) throw new CErr('scanf : il manque le & devant l\'argument ' + (i + 2) + ' (scanf("%d", &x))', L);
          }
          const lv = this.LV(target);
          if (lv.str) throw new CErr('scanf vers un caractère de chaîne non supporté', L);
          return '$v=>{' + lv.c + '=' + this.conv(lv.t, { c: '$v', t: lv.t.k === 'string' ? T('string') : isFloat(lv.t) ? T('double') : T('long') }, L) + '}';
        });
        return { c: '(await $i.scanf(' + JSON.stringify(e.args[0].v) + ',[' + sets.join(',') + ']))', t: T('int') };
      }
      case 'getline': {
        if (e.args.length < 2 || e.args[0].k !== 'id' || e.args[0].name !== 'cin') throw new CErr('getline s\'utilise ainsi : getline(cin, maChaine)', L);
        const lv = this.LV(e.args[1]);
        if (lv.t.k !== 'string') throw new CErr('getline lit dans une variable string', L);
        const delim = e.args[2] ? this.E(e.args[2]).c : '10';
        return { c: '(await $i.getline($v=>{' + lv.c + '=$v},' + delim + '))', t: T('bool') };
      }
      case 'to_string': { const [a] = this.argsOf(e, 1, name); this.num(a, L, name); return { c: (isFloat(a.t) ? '$rt.tostrf(' : 'String(') + a.c + ')', t: T('string') }; }
      case 'stoi': case 'stol': case 'stoll': case 'atoi': case 'atol': { const [a] = this.argsOf(e, 1, name); return { c: '$rt.stoi(' + a.c + ')', t: T(name === 'stoi' || name === 'atoi' ? 'int' : 'long') }; }
      case 'stod': case 'stof': case 'atof': { const [a] = this.argsOf(e, 1, name); return { c: '$rt.stod(' + a.c + ')', t: T(name === 'stof' ? 'float' : 'double') }; }
      case 'strlen': { const [a] = this.argsOf(e, 1, name); return { c: a.c + '.length', t: T('long') }; }
      case 'strcmp': { const [a, b] = this.argsOf(e, 2, name); return { c: '$rt.cmp(' + a.c + ',' + b.c + ')', t: T('int') }; }
      case 'strcpy': { const lv = this.LV(e.args[0]); const b = this.E(e.args[1]); return { c: '(' + lv.c + '=' + b.c + ')', t: T('string') }; }
      case 'strcat': { const lv = this.LV(e.args[0]); const b = this.E(e.args[1]); return { c: '(' + lv.c + '+=' + b.c + ')', t: T('string') }; }
      case 'toupper': case 'tolower': { const [a] = this.argsOf(e, 1, name); return { c: '$rt.' + name + '(' + a.c + ')', t: T('int') }; }
      case 'isdigit': case 'isalpha': case 'isspace': case 'isupper': case 'islower': case 'isalnum': case 'ispunct': {
        const [a] = this.argsOf(e, 1, name); return { c: '$rt.' + name + '(' + a.c + ')', t: T('bool') };
      }
      case 'swap': {
        if (e.args.length !== 2) throw new CErr('swap attend 2 arguments', L);
        const a = this.LV(e.args[0]), b = this.LV(e.args[1]);
        if (a.str || b.str) throw new CErr('swap sur des caractères de chaîne non supporté', L);
        if (tname(a.t) !== tname(b.t)) throw new CErr('swap : les deux variables doivent avoir le même type', L);
        return { c: '(()=>{const $x=' + a.c + ';' + a.c + '=' + b.c + ';' + b.c + '=$x;})()', t: T('void') };
      }
      case 'sort': case 'reverse': {
        if (e.args.length < 2) throw new CErr(name + '(debut, fin) attend 2 arguments', L);
        const r = this.range(e.args[0], e.args[1], L);
        if (name === 'reverse') return { c: '$rt.reverse(' + r + ')', t: T('void') };
        let cmp = 'null';
        if (e.args[2]) {
          const f = e.args[2];
          if (f.k === 'call' && f.f.k === 'id' && f.f.name === 'greater') cmp = "'desc'";
          else if (f.k === 'id' && this.funcs.has(f.name)) { const s = this.funcs.get(f.name)[0]; this.usedFns.add(s.js); cmp = s.js; }
          else throw new CErr('Comparateur de sort non supporté', L);
        }
        return { c: '(await $rt.sort(' + r + ',' + cmp + '))', t: T('void') };
      }
      case 'greater': throw new CErr('greater<T>() s\'utilise dans sort(..., greater<int>())', L);
    }
    throw new CErr('« ' + name + ' » n\'est pas déclaré (fonction inconnue)', L);
  }
  range(a, b, L) {
    // v.begin(), v.end() | tab, tab + n | v.begin()+i
    const pos = (n) => {
      let x = n; while (x.k === 'paren') x = x.e;
      if (x.k === 'call' && x.f.k === 'member' && (x.f.name === 'begin' || x.f.name === 'end')) {
        const v = this.E(x.f.e); return { base: v, off: x.f.name === 'begin' ? '0' : v.c + '.length' };
      }
      if (x.k === 'bin' && (x.op === '+' || x.op === '-')) {
        const p = pos(x.l); const k = this.E(x.r); return { base: p.base, off: '(' + p.off + x.op + k.c + ')' };
      }
      const v = this.E(x);
      if (v.t.k === 'array') return { base: v, off: '0' };
      throw new CErr('Intervalle non supporté (utilise v.begin(), v.end() ou tab, tab + n)', L);
    };
    const p = pos(a), q = pos(b);
    return p.base.c + ',' + p.off + ',' + q.off;
  }
  checkPrintf(fmt, args, L) {
    const re = /%[-+ #0]*(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|L|z)?([diouxXfFeEgGcsp%])/g;
    let m, i = 0;
    while ((m = re.exec(fmt))) {
      if (m[4] === '%') continue;
      if (m[1] === '*') i++; if (m[2] === '*') i++;
      const a = args[i++];
      if (!a) { this.warnings.push({ line: L, msg: 'printf : le format « ' + m[0] + ' » n\'a pas d\'argument correspondant' }); return; }
      const c = m[4];
      if ('di'.includes(c) && isFloat(a.t)) this.warnings.push({ line: L, msg: 'printf : « ' + m[0] + ' » attend un entier mais reçoit un ' + a.t.k + ' (utilise %f ou %lf)' });
      if ('fFeEgG'.includes(c) && isIntegral(a.t)) this.warnings.push({ line: L, msg: 'printf : « ' + m[0] + ' » attend un réel mais reçoit un entier (utilise %d)' });
      if (c === 's' && a.t.k !== 'string') this.warnings.push({ line: L, msg: 'printf : %s attend une chaîne' });
    }
    if (i < args.length) this.warnings.push({ line: L, msg: 'printf : plus d\'arguments que de formats %' });
  }

  Emethod(e) {
    const m = e.f.name, obj = e.f.e, L = e.line;
    // cin.xxx()
    if (obj.k === 'id' && !this.lookup(obj.name) && (obj.name === 'cin' || obj.name === 'cout')) {
      this.checkStd(obj);
      if (obj.name === 'cout') {
        if (m === 'flush') return { c: '$o.flush()', t: T('void') };
        if (m === 'precision') { const [a] = this.argsOf(e, 1, 'precision'); return { c: '$o.prec(' + a.c + ')', t: T('int') }; }
        if (m === 'setf' || m === 'unsetf') return { c: '0', t: T('void') };
        throw new CErr('cout.' + m + '() non supporté', L);
      }
      switch (m) {
        case 'ignore': { const a = e.args.map(x => this.E(x).c); return { c: '(await $i.ignore(' + (a[0] || '1') + ',' + (a[1] || '-1') + '))', t: T('void') }; }
        case 'clear': return { c: '$i.clear()', t: T('void') };
        case 'fail': return { c: '$i.fail()', t: T('bool') };
        case 'good': return { c: '$i.ok()', t: T('bool') };
        case 'eof': return { c: '$i.eof()', t: T('bool') };
        case 'get': {
          if (e.args.length === 0) return { c: '(await $i.getchar())', t: T('int') };
          const lv = this.LV(e.args[0]); return { c: '(await $i.get($v=>{' + lv.c + '=$v}))', t: T('bool') };
        }
        case 'peek': return { c: '(await $i.peek())', t: T('int') };
        case 'sync': return { c: '0', t: T('int') };
      }
      throw new CErr('cin.' + m + '() non supporté', L);
    }
    const o = this.E(obj);
    const A = (n) => this.argsOf(e, n, '.' + m + '()');
    if (o.t.k === 'string') {
      const base = () => this.LV(obj);
      switch (m) {
        case 'length': case 'size': A(0); return { c: o.c + '.length', t: T('long') };
        case 'empty': A(0); return { c: '(' + o.c + '.length===0)', t: T('bool') };
        case 'c_str': case 'data': A(0); return o;
        case 'at': { const [i] = A(1); return { c: '$rt.at(' + o.c + ',' + i.c + ')', t: T('char') }; }
        case 'back': A(0); return { c: '$rt.at(' + o.c + ',' + o.c + '.length-1)', t: T('char') };
        case 'front': A(0); return { c: '$rt.at(' + o.c + ',0)', t: T('char') };
        case 'substr': { const a = e.args.map(x => this.E(x)); return { c: '$rt.substr(' + o.c + ',' + (a[0] ? a[0].c : '0') + ',' + (a[1] ? a[1].c : 'undefined') + ')', t: T('string') }; }
        case 'find': case 'rfind': {
          const a = e.args.map(x => this.E(x));
          const what = a[0].t.k === 'char' ? 'String.fromCharCode(' + a[0].c + ')' : a[0].c;
          return { c: '$rt.' + m + '(' + o.c + ',' + what + ',' + (a[1] ? a[1].c : 'undefined') + ')', t: T('long') };
        }
        case 'push_back': { const lv = base(); const [c] = A(1); return { c: '(' + lv.c + '+=String.fromCharCode(' + c.c + '))', t: T('void') }; }
        case 'pop_back': { const lv = base(); A(0); return { c: '(' + lv.c + '=$rt.popb(' + lv.c + '))', t: T('void') }; }
        case 'append': { const lv = base(); const [s] = A(1); return { c: '(' + lv.c + '+=' + this.conv(T('string'), s, L) + ')', t: T('string') }; }
        case 'clear': { const lv = base(); A(0); return { c: '(' + lv.c + "='')", t: T('void') }; }
        case 'insert': { const lv = base(); const a = e.args.map(x => this.E(x)); return { c: '(' + lv.c + '=$rt.sins(' + lv.c + ',' + a[0].c + ',' + this.conv(T('string'), a[1], L) + '))', t: T('string') }; }
        case 'erase': { const lv = base(); const a = e.args.map(x => this.E(x)); return { c: '(' + lv.c + '=$rt.serase(' + lv.c + ',' + (a[0] ? a[0].c : '0') + ',' + (a[1] ? a[1].c : 'undefined') + '))', t: T('string') }; }
        case 'compare': { const [s] = A(1); return { c: '$rt.cmp(' + o.c + ',' + s.c + ')', t: T('int') }; }
        case 'begin': case 'end': throw new CErr('Les itérateurs ne sont utilisables que dans sort/reverse', L);
      }
      throw new CErr('Méthode string .' + m + '() non supportée', L);
    }
    if (o.t.k === 'vector') {
      switch (m) {
        case 'size': A(0); return { c: o.c + '.length', t: T('long') };
        case 'empty': A(0); return { c: '(' + o.c + '.length===0)', t: T('bool') };
        case 'push_back': case 'emplace_back': {
          if (e.args.length !== 1) throw new CErr('push_back attend 1 argument', L);
          return { c: o.c + '.push(' + this.initValue(o.t.of, e.args[0], L) + ')', t: T('void') };
        }
        case 'pop_back': A(0); return { c: '$rt.vpop(' + o.c + ')', t: T('void') };
        case 'back': A(0); return { c: o.c + '[$rt.ck(' + o.c + ',' + o.c + '.length-1)]', t: o.t.of };
        case 'front': A(0); return { c: o.c + '[$rt.ck(' + o.c + ',0)]', t: o.t.of };
        case 'at': { const [i] = A(1); return { c: o.c + '[$rt.ck(' + o.c + ',' + i.c + ')]', t: o.t.of }; }
        case 'clear': A(0); return { c: '(' + o.c + '.length=0)', t: T('void') };
        case 'resize': { const a = e.args.map(x => this.E(x)); const z = a[1] ? this.conv(o.t.of, a[1], L) : this.zeroOf(o.t.of); return { c: '$rt.resize(' + o.c + ',' + a[0].c + ',()=>' + z + ')', t: T('void') }; }
        case 'erase': {
          const r = e.args.length === 2 ? this.range(e.args[0], e.args[1], L) : (() => { const x = this.range(e.args[0], e.args[0], L).split(','); return x[0] + ',' + x[1] + ',' + x[1] + '+1'; })();
          return { c: '$rt.verase(' + r + ')', t: T('void') };
        }
        case 'insert': {
          const p = this.range(e.args[0], e.args[0], L).split(',');
          return { c: '$rt.vins(' + p[0] + ',' + p[1] + ',' + this.initValue(o.t.of, e.args[1], L) + ')', t: T('void') };
        }
        case 'begin': case 'end': throw new CErr('Les itérateurs ne sont utilisables que dans sort/reverse/erase/insert', L);
      }
      throw new CErr('Méthode vector .' + m + '() non supportée', L);
    }
    if (o.t.k === 'struct') throw new CErr('Les méthodes de structure ne sont pas supportées', L);
    throw new CErr('« .' + m + '() » : ' + tname(o.t) + ' n\'a pas de méthode', L);
  }
}

// noeud "raw" pour les opérations composées (x += y)
const _E = Gen.prototype.E;
Gen.prototype.E = function (e) { if (e.k === 'raw') return { c: e.c, t: e.t }; return _E.call(this, e); };

function compile(src, opts) {
  let warnings = [];
  try {
    const { toks, includes } = lex(src);
    const p = new Parser(toks);
    const ast = p.parseProgram();
    warnings = p.warnings;
    const g = new Gen(ast, includes, warnings, opts);
    const body = 'let $L=0,$T=0,$D=0;\ntry{\n' + g.gen() + '\n}catch($x){if($x&&typeof $x===\'object\'&&$x.cppLine==null)$x.cppLine=$L;throw $x;}';
    // tri + dédoublonnage des avertissements
    const seen = new Set();
    warnings = warnings.filter(w => { const k = w.line + w.msg; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.line - b.line);
    return { ok: true, body, warnings };
  } catch (e) {
    if (e instanceof CErr) return { ok: false, error: { msg: e.message, line: e.line }, warnings };
    return { ok: false, error: { msg: 'Erreur interne du compilateur : ' + e.message, line: 0 }, warnings };
  }
}

return { compile };
})();
if (typeof module !== 'undefined') module.exports = CPP;
