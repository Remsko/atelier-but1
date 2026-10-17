/* Runtime du mini C/C++ : flux cout/cin, printf/scanf, helpers.
 * CppRuntime(io) -> { $rt, $o, $e, $i }
 * io = { write(text, isErr), readLine(): Promise<string|null>, clear() }
 */
function CppRuntime(io) {
  'use strict';
  class RtErr extends Error { constructor(m) { super(m); this.cppRuntime = true; } }
  const err = m => new RtErr(m);
  const OUT_LIMIT = 2000000;

  /* ---------- sortie ---------- */
  let buf = '', ebuf = '', total = 0, last = Date.now();
  function flush() {
    if (buf) { io.write(buf, false); buf = ''; }
    if (ebuf) { io.write(ebuf, true); ebuf = ''; }
    last = Date.now();
  }
  function trimZeros(s) { if (s.indexOf('.') < 0) return s; s = s.replace(/0+$/, ''); return s.endsWith('.') ? s.slice(0, -1) : s; }
  function expFmt(x, p, upper) { // d.ddde+XX
    let s = x.toExponential(Math.min(100, Math.max(0, p)));
    let [m, e] = s.split('e');
    let sign = e[0] === '-' ? '-' : '+'; e = e.replace(/^[+-]/, '');
    if (e.length < 2) e = '0' + e;
    return m + (upper ? 'E' : 'e') + sign + e;
  }
  function special(x, upper) {
    const s = isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    return upper ? s.toUpperCase() : s;
  }
  function fixedFmt(x, p) {
    p = Math.min(100, Math.max(0, p));
    if (Math.abs(x) < 1e21) return x.toFixed(p);
    // très grands nombres : développement exact via BigInt
    let s = BigInt(Math.round(x)).toString();
    return p > 0 ? s + '.' + '0'.repeat(p) : s;
  }
  function gFmt(x, p, alt, upper) {
    if (p === 0) p = 1;
    if (x === 0) return Object.is(x, -0) ? '-0' : (alt ? '0.' + '0'.repeat(p - 1) : '0');
    const e = x.toExponential(Math.min(100, p - 1));
    const exp = parseInt(e.split('e')[1], 10);
    if (exp < -4 || exp >= p) {
      let s = expFmt(x, p - 1, upper);
      if (!alt) { let [m, ex] = s.split(/[eE]/); s = trimZeros(m) + (upper ? 'E' : 'e') + ex; }
      return s;
    }
    let s = x.toFixed(Math.min(100, Math.max(0, p - 1 - exp)));
    return alt ? s : trimZeros(s);
  }

  function makeStream(isErr) {
    const st = { field: null, prec: 6, width: 0, fill: ' ', left: false, boolalpha: false, showpoint: false, showpos: false, upper: false, base: 10 };
    function emit(s) {
      total += s.length;
      if (total > OUT_LIMIT) { flush(); throw err('Sortie trop longue (plus de 2 millions de caractères) : boucle infinie ?'); }
      if (isErr) ebuf += s; else buf += s;
      if (buf.length + ebuf.length > 16384) flush();
    }
    function pad(s) {
      if (st.width > s.length) { const p = st.fill.repeat(st.width - s.length); s = st.left ? s + p : p + s; }
      st.width = 0; return s;
    }
    const o = {
      i(v) {
        let s;
        if (st.base === 16) s = (v < 0 ? (v >>> 0) : v).toString(16);
        else if (st.base === 8) s = (v < 0 ? (v >>> 0) : v).toString(8);
        else s = (st.showpos && v >= 0 ? '+' : '') + String(v);
        if (st.upper) s = s.toUpperCase();
        emit(pad(s));
      },
      f(v) {
        let s;
        if (!isFinite(v)) s = special(v, st.upper);
        else if (st.field === 'fixed') s = fixedFmt(v, st.prec);
        else if (st.field === 'scientific') s = expFmt(v, st.prec, st.upper);
        else s = gFmt(v, st.prec, st.showpoint, st.upper);
        if (st.showpos && v >= 0) s = '+' + s;
        emit(pad(s));
      },
      c(v) { emit(pad(String.fromCharCode(v & 0xFFFF))); },
      s(v) { emit(pad(String(v))); },
      b(v) { emit(pad(st.boolalpha ? (v ? 'true' : 'false') : (v ? '1' : '0'))); },
      endl() { emit('\n'); flush(); },
      flush() { flush(); },
      m(k) {
        switch (k) {
          case 'fixed': case 'scientific': st.field = k; break;
          case 'defaultfloat': st.field = null; break;
          case 'left': st.left = true; break; case 'right': st.left = false; break;
          case 'boolalpha': st.boolalpha = true; break; case 'noboolalpha': st.boolalpha = false; break;
          case 'showpoint': st.showpoint = true; break; case 'noshowpoint': st.showpoint = false; break;
          case 'showpos': st.showpos = true; break; case 'noshowpos': st.showpos = false; break;
          case 'uppercase': st.upper = true; break; case 'nouppercase': st.upper = false; break;
          case 'hex': st.base = 16; break; case 'dec': st.base = 10; break; case 'oct': st.base = 8; break;
        }
      },
      prec(n) { const old = st.prec; st.prec = n < 0 ? 6 : n; return old; },
      setw(n) { st.width = n; },
      fill(c) { st.fill = typeof c === 'number' ? String.fromCharCode(c) : String(c)[0] || ' '; },
      printf(fmt, args) {
        const out = sprintf(fmt, args);
        emit(out);
        return out.length;
      }
    };
    return o;
  }

  function sprintf(fmt, args) {
    let ai = 0, out = '';
    const re = /%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|L|z|j|t)?([diouxXfFeEgGcsp%])/g;
    let lastIdx = 0, m;
    while ((m = re.exec(fmt))) {
      out += fmt.slice(lastIdx, m.index); lastIdx = re.lastIndex;
      const conv = m[5];
      if (conv === '%') { out += '%'; continue; }
      const flags = m[1];
      let width = m[2] === '*' ? args[ai++] : (m[2] ? parseInt(m[2], 10) : 0);
      let prec = m[3] === '*' ? args[ai++] : (m[3] !== undefined ? (m[3] === '' ? 0 : parseInt(m[3], 10)) : null);
      let left = flags.includes('-');
      if (width < 0) { left = true; width = -width; }
      const zero = flags.includes('0') && !left;
      const plus = flags.includes('+'), space = flags.includes(' '), alt = flags.includes('#');
      let v = args[ai++];
      let s, numeric = true;
      if (v === undefined) v = 0;
      switch (conv) {
        case 'd': case 'i': {
          v = Math.trunc(Number(v)) || 0;
          s = String(Math.abs(v));
          if (prec !== null) s = s.padStart(prec, '0');
          s = (v < 0 ? '-' : plus ? '+' : space ? ' ' : '') + s;
          break;
        }
        case 'u': v = Math.trunc(Number(v)); s = String(v < 0 ? v >>> 0 : v); break;
        case 'x': case 'X': v = Math.trunc(Number(v)); s = (v < 0 ? v >>> 0 : v).toString(16); if (conv === 'X') s = s.toUpperCase(); if (alt && v) s = (conv === 'X' ? '0X' : '0x') + s; break;
        case 'o': v = Math.trunc(Number(v)); s = (v < 0 ? v >>> 0 : v).toString(8); break;
        case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': {
          v = Number(v); const p = prec === null ? 6 : prec;
          if (!isFinite(v)) s = special(v, conv === conv.toUpperCase());
          else if (conv === 'f' || conv === 'F') s = fixedFmt(v, p);
          else if (conv === 'e' || conv === 'E') s = expFmt(v, p, conv === 'E');
          else s = gFmt(v, p, alt, conv === 'G');
          if (v >= 0 && !s.startsWith('-')) s = (plus ? '+' : space ? ' ' : '') + s;
          break;
        }
        case 'c': s = String.fromCharCode(Number(v) & 0xFFFF); numeric = false; break;
        case 's': s = String(v); if (prec !== null) s = s.slice(0, prec); numeric = false; break;
        case 'p': s = '0x7ffd' + (Math.random() * 1e8 | 0).toString(16); break;
      }
      if (s.length < width) {
        if (left) s = s.padEnd(width, ' ');
        else if (zero && numeric && !/[a-z]/i.test(s.replace(/^[-+ ]?(0x)?/i, '').replace(/e[+-]\d+$/i, ''))) {
          const sign = /^[-+ ]/.test(s) ? s[0] : ''; const rest = sign ? s.slice(1) : s;
          s = sign + rest.padStart(width - sign.length, '0');
        } else s = s.padStart(width, ' ');
      }
      out += s;
    }
    return out + fmt.slice(lastIdx);
  }

  const $o = makeStream(false), $e = makeStream(true);

  /* ---------- entrée ---------- */
  let ib = '', ip = 0, failed = false, eofed = false;
  async function more() {
    if (eofed) return false;
    flush();
    const line = await io.readLine();
    if (line === null) { eofed = true; return false; }
    ib = ib.slice(ip) + line + '\n'; ip = 0;
    return true;
  }
  async function peekc() {
    while (ip >= ib.length) { if (!(await more())) return null; }
    return ib[ip];
  }
  const isWs = c => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\v' || c === '\f';
  async function skipWs() {
    for (;;) { const c = await peekc(); if (c === null) return false; if (isWs(c)) ip++; else return true; }
  }
  async function readIntTok() {
    if (!(await skipWs())) return null;
    let s = '';
    let c = await peekc();
    if (c === '+' || c === '-') { s += c; ip++; }
    while ((c = await peekc()) !== null && c >= '0' && c <= '9') { s += c; ip++; }
    if (!/\d/.test(s)) { ip -= s.length; return undefined; }
    return parseInt(s, 10);
  }
  async function readFloatTok() {
    if (!(await skipWs())) return null;
    let s = '', c = await peekc();
    if (c === '+' || c === '-') { s += c; ip++; }
    let digits = 0;
    while ((c = await peekc()) !== null && c >= '0' && c <= '9') { s += c; ip++; digits++; }
    if (c === '.' || c === ',') { // on accepte la virgule française... non : C++ s'arrête sur ','
      if (c === '.') { s += c; ip++; while ((c = await peekc()) !== null && c >= '0' && c <= '9') { s += c; ip++; digits++; } }
    }
    if (!digits) { ip -= s.length; return undefined; }
    if (c === 'e' || c === 'E') {
      const save = ip; let t = c; ip++;
      let d = await peekc();
      if (d === '+' || d === '-') { t += d; ip++; }
      let ed = 0;
      while ((d = await peekc()) !== null && d >= '0' && d <= '9') { t += d; ip++; ed++; }
      if (ed) s += t; else ip = save;
    }
    return parseFloat(s);
  }
  async function readWord() {
    if (!(await skipWs())) return null;
    let s = '', c;
    while ((c = await peekc()) !== null && !isWs(c)) { s += c; ip++; }
    return s;
  }

  const $i = {
    async rd(kind, set) {
      if (failed) return;
      let v;
      if (kind === 'i' || kind === 'b') {
        v = await readIntTok();
        if (v === null) { failed = true; return; }
        if (v === undefined) { failed = true; set(0); return; }
        if (kind === 'b' && v !== 0 && v !== 1) { failed = true; set(1); return; }
        set(v);
      } else if (kind === 'f') {
        v = await readFloatTok();
        if (v === null) { failed = true; return; }
        if (v === undefined) { failed = true; set(0); return; }
        set(v);
      } else if (kind === 'c') {
        if (!(await skipWs())) { failed = true; return; }
        set(ib.charCodeAt(ip++));
      } else {
        v = await readWord();
        if (v === null) { failed = true; return; }
        set(v);
      }
    },
    async ws() { await skipWs(); },
    ok() { return !failed; },
    fail() { return failed; },
    eof() { return eofed && ip >= ib.length; },
    clear() { failed = false; },
    async ignore(n, delim) {
      if (n > 1e9) n = Infinity;
      let k = 0;
      while (k < n) { const c = await peekc(); if (c === null) break; ip++; k++; if (c.charCodeAt(0) === delim) break; }
    },
    async getline(set, delim) {
      if (failed) return false;
      let s = '', c, any = false;
      for (;;) {
        c = await peekc();
        if (c === null) break;
        ip++; any = true;
        if (c.charCodeAt(0) === delim) break;
        s += c;
      }
      if (!any) { failed = true; return false; }
      set(s.replace(/\r$/, ''));
      return true;
    },
    async getchar() { const c = await peekc(); if (c === null) return -1; ip++; return c.charCodeAt(0); },
    async peek() { const c = await peekc(); return c === null ? -1 : c.charCodeAt(0); },
    async get(set) { const c = await peekc(); if (c === null) { failed = true; return false; } ip++; set(c.charCodeAt(0)); return true; },
    async scanf(fmt, sets) {
      let n = 0, si = 0;
      const re = /%(\*)?(\d+)?(hh|h|ll|l|L)?([diufFeEgGcsx%])|(\s+)|([^%\s]+)/g;
      let m;
      while ((m = re.exec(fmt))) {
        if (m[5]) { await skipWs(); continue; }
        if (m[6]) {
          for (const ch of m[6]) { const c = await peekc(); if (c !== ch) return n || (c === null ? -1 : n); ip++; }
          continue;
        }
        const conv = m[4], skip = !!m[1], width = m[2] ? parseInt(m[2], 10) : Infinity;
        if (conv === '%') { await skipWs(); if ((await peekc()) !== '%') return n; ip++; continue; }
        let v;
        if ('dixu'.includes(conv)) {
          if (conv === 'x') { if (!(await skipWs())) return n || -1; let s = ''; let c; while ((c = await peekc()) !== null && /[0-9a-fA-F]/.test(c) && s.length < width) { s += c; ip++; } if (!s) return n; v = parseInt(s, 16); }
          else { v = await readIntTok(); if (v === null) return n || -1; if (v === undefined) return n; }
        } else if ('fFeEgG'.includes(conv)) {
          v = await readFloatTok(); if (v === null) return n || -1; if (v === undefined) return n;
        } else if (conv === 'c') {
          const c = await peekc(); if (c === null) return n || -1; ip++; v = c.charCodeAt(0);
        } else if (conv === 's') {
          if (!(await skipWs())) return n || -1;
          let s = '', c; while ((c = await peekc()) !== null && !isWs(c) && s.length < width) { s += c; ip++; } v = s;
        }
        if (!skip) { const set = sets[si++]; if (!set) throw err('scanf : pas assez de variables pour le format "' + fmt + '"'); set(v); n++; }
      }
      return n;
    }
  };

  /* ---------- helpers ---------- */
  let seed = 1;
  const $rt = {
    err,
    tick() { if (Date.now() - last > 60) flush(); },
    flush,
    stack() { throw err('Dépassement de pile : trop d\'appels imbriqués (récursion infinie ?)'); },
    idiv(a, b) { if (b === 0) throw err('Division entière par zéro'); return (a / b) | 0; },
    udiv(a, b) { if (b === 0) throw err('Division entière par zéro'); return Math.trunc(a / b) >>> 0; },
    ldiv(a, b) { if (b === 0) throw err('Division entière par zéro'); return Math.trunc(a / b); },
    imod(a, b) { if (b === 0) throw err('Modulo par zéro (x % 0)'); return a % b; },
    ck(a, i) {
      if (i >= 0 && i < a.length) return i;
      throw err('Indice ' + i + ' hors limites (le tableau a ' + a.length + ' case' + (a.length > 1 ? 's' : '') + ', indices de 0 à ' + (a.length - 1) + ')');
    },
    arr(dims, init, mk) {
      for (const d of dims) if (!(d > 0)) throw err('Taille de tableau invalide : ' + d);
      if (dims.reduce((a, b) => a * b, 1) > 2e7) throw err('Tableau trop grand');
      const build = (k, lit) => {
        const n = dims[k], a = new Array(n);
        if (lit && lit.length > n) throw err('Trop de valeurs pour initialiser le tableau (' + lit.length + ' pour ' + n + ' cases)');
        for (let i = 0; i < n; i++) a[i] = k < dims.length - 1 ? build(k + 1, lit && lit[i]) : (lit && i < lit.length ? lit[i] : mk());
        return a;
      };
      return build(0, init);
    },
    vec(n, mk) { if (n < 0) throw err('Taille de vector négative'); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = mk(); return a; },
    rep(n, c) { return String.fromCharCode(c).repeat(Math.max(0, n)); },
    clone(x) {
      if (Array.isArray(x)) return x.map(v => (typeof v === 'object' && v !== null) ? $rt.clone(v) : v);
      if (typeof x === 'object' && x !== null) { const o = {}; for (const k in x) { const v = x[k]; o[k] = (typeof v === 'object' && v !== null) ? $rt.clone(v) : v; } return o; }
      return x;
    },
    vset(t, s) { const c = $rt.clone(s); t.length = 0; for (const v of c) t.push(v); return t; },
    sset(t, s) { Object.assign(t, $rt.clone(s)); return t; },
    vpop(v) { if (!v.length) throw err('pop_back() sur un vector vide'); v.pop(); },
    resize(v, n, mk) { if (n < v.length) v.length = n; else while (v.length < n) v.push(mk()); },
    verase(v, a, b) { if (a < 0 || b > v.length || a > b) throw err('erase : position hors limites'); v.splice(a, b - a); },
    vins(v, a, x) { if (a < 0 || a > v.length) throw err('insert : position hors limites'); v.splice(a, 0, x); },
    async sort(v, a, b, cmp) {
      const part = v.slice(a, b);
      let f;
      if (cmp === 'desc') f = (x, y) => (x < y ? 1 : x > y ? -1 : 0);
      else if (typeof cmp === 'function') {
        // comparateur utilisateur async : tri par insertion binaire (merge sort)
        const ms = async (arr) => {
          if (arr.length < 2) return arr;
          const m = arr.length >> 1; const l = await ms(arr.slice(0, m)), r = await ms(arr.slice(m));
          const out = []; let i = 0, j = 0;
          while (i < l.length && j < r.length) { if (await cmp(r[j], l[i])) out.push(r[j++]); else out.push(l[i++]); }
          return out.concat(l.slice(i), r.slice(j));
        };
        const s = await ms(part); for (let i = 0; i < s.length; i++) v[a + i] = s[i]; return;
      } else f = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
      part.sort(f); for (let i = 0; i < part.length; i++) v[a + i] = part[i];
    },
    reverse(v, a, b) { const p = v.slice(a, b).reverse(); for (let i = 0; i < p.length; i++) v[a + i] = p[i]; },
    ch(s, i) { if (i < 0 || i > s.length) throw err('Indice ' + i + ' hors limites de la chaîne (longueur ' + s.length + ')'); return i === s.length ? 0 : s.charCodeAt(i); },
    at(s, i) { if (i < 0 || i >= s.length) throw err('at(' + i + ') hors limites de la chaîne (longueur ' + s.length + ')'); return s.charCodeAt(i); },
    setch(s, i, c) {
      if (i < 0) throw err('Indice ' + i + ' hors limites de la chaîne');
      if (i >= s.length) { if (c === 0) return s.slice(0, i); s = s + '\0'.repeat(i - s.length + 1); }
      if (c === 0) return s.slice(0, i);
      return s.slice(0, i) + String.fromCharCode(c) + s.slice(i + 1);
    },
    substr(s, p, n) { if (p < 0 || p > s.length) throw err('substr(' + p + ') : position hors de la chaîne (longueur ' + s.length + ')'); return n === undefined ? s.slice(p) : s.substr(p, Math.max(0, n)); },
    find(s, x, p) { return s.indexOf(x, p || 0); },
    rfind(s, x, p) { return p === undefined ? s.lastIndexOf(x) : s.lastIndexOf(x, p); },
    popb(s) { if (!s.length) throw err('pop_back() sur une chaîne vide'); return s.slice(0, -1); },
    sins(s, p, x) { if (p < 0 || p > s.length) throw err('insert : position hors limites'); return s.slice(0, p) + x + s.slice(p); },
    serase(s, p, n) { if (p < 0 || p > s.length) throw err('erase : position hors limites'); return n === undefined ? s.slice(0, p) : s.slice(0, p) + s.slice(p + n); },
    cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
    mins(a, b) { return b < a ? b : a; }, maxs(a, b) { return a < b ? b : a; },
    tostrf(x) { return isFinite(x) ? x.toFixed(6) : special(x); },
    stoi(s) { const m = /^\s*[+-]?\d+/.exec(s); if (!m) throw err('stoi : « ' + s + ' » n\'est pas un nombre entier'); return parseInt(m[0], 10); },
    stod(s) { const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s); if (!m) throw err('stod : « ' + s + ' » n\'est pas un nombre'); return parseFloat(m[0]); },
    toupper(c) { return c >= 97 && c <= 122 ? c - 32 : c; }, tolower(c) { return c >= 65 && c <= 90 ? c + 32 : c; },
    isdigit(c) { return c >= 48 && c <= 57; }, isalpha(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); },
    isupper(c) { return c >= 65 && c <= 90; }, islower(c) { return c >= 97 && c <= 122; },
    isalnum(c) { return $rt.isdigit(c) || $rt.isalpha(c); }, isspace(c) { return c === 32 || (c >= 9 && c <= 13); },
    ispunct(c) { return c > 32 && c < 127 && !$rt.isalnum(c); },
    round(x) { return x < 0 ? -Math.round(-x) : Math.round(x); },
    postf(a) { return a; },
    rand() { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; },
    srand(s) { seed = (s >>> 0) || 1; },
    clock() { return Math.round(performance.now() * 1000); },
    exit(c) { const e = new Error('exit'); e.cppExit = c | 0; throw e; },
    system(cmd) {
      cmd = String(cmd).trim().toLowerCase();
      if (cmd === 'cls' || cmd === 'clear') { flush(); io.clear(); }
      return 0;
    }
  };
  return { $rt, $o, $e, $i };
}
if (typeof module !== "undefined") { module.exports = CppRuntime; }

/* Débogueur : $B.c(ligne, snapshot) décide s'il faut s'arrêter, $B.w() met en pause.
 * post(msg) envoie l'état à la page ; B.msg(cmd) reprend l'exécution. */
function CppDebugger(env, post, initBps) {
  'use strict';
  let mode = 'into', target = 0, bps = new Set(initBps || []), frames = [], resume = null;
  function ser(v, t, d) {
    if (!t) return { s: String(v) };
    switch (t.k) {
      case 'char': {
        const c = v | 0;
        const lit = c === 10 ? "'\\n'" : c === 0 ? "'\\0'" : c === 9 ? "'\\t'" : c === 32 ? "' '" : (c > 32 && c !== 127) ? "'" + String.fromCharCode(c) + "'" : String(c);
        return { s: lit, x: String(c) };
      }
      case 'bool': return { s: v ? 'true' : 'false' };
      case 'float': return { s: Number.isFinite(v) ? String(+Math.fround(v).toPrecision(7)) : String(v) };
      case 'double': return { s: Number.isFinite(v) ? String(+(+v).toPrecision(15)) : String(v) };
      case 'string': return { s: JSON.stringify(String(v)) };
      case 'array': case 'vector':
        if (!Array.isArray(v)) return { s: '?' };
        if (d > 3) return { s: '[…]' };
        return { a: v.slice(0, 80).map(x => ser(x, t.of, d + 1)), n: v.length };
      case 'struct': return { o: (t.f || []).map(([f, ft]) => [f, ser(v && v['f_' + f], ft, d + 1)]) };
      default: return { s: String(v) };
    }
  }
  function vars(list) { return list.map(([n, ti, v]) => { const t = B.T[ti]; return { n, t: t ? t.n : '', v: ser(v, t, 0) }; }); }
  const B = {
    T: [], g: null,
    in(fn) { frames.push({ fn, line: 0, snap: null }); },
    out() { frames.pop(); },
    c(line, snap) {
      const f = frames[frames.length - 1];
      if (f) { f.line = line; f.snap = snap; }
      const d = frames.length;
      if (mode === 'into') return true;
      if (bps.has(line)) return true;
      if (mode === 'over') return d <= target;
      if (mode === 'out') return d < target;
      return false;
    },
    async w() {
      try { env.$rt.flush(); } catch (_) {}
      const fr = frames.slice().reverse().map(f => ({ fn: f.fn, line: f.line, vars: f.snap ? vars(f.snap()) : [] }));
      post({ t: 'pause', line: frames.length ? frames[frames.length - 1].line : 0, frames: fr, globals: B.g ? vars(B.g()) : [] });
      const cmd = await new Promise(r => { resume = r; });
      mode = cmd.cmd; if (cmd.bps) bps = new Set(cmd.bps); target = frames.length;
    },
    msg(d) {
      if (d.t === 'bps') { bps = new Set(d.bps || []); return; }
      if (resume) { const r = resume; resume = null; r(d); }
    }
  };
  return B;
}
if (typeof module !== 'undefined') module.exports.CppDebugger = CppDebugger;
