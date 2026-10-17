"""Construit la version « vrai site web » : dist/index.html (+ config.example.js).
Base : la version « potes » (rien de personnel à Rémi), + couche web/shim.js (comptes, fichiers, EDT)."""
import json, os, re, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..')
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()
s = rd('site.html')
cpp, rt, chk, sqlk = rd('cpp.js'), rd('runtime.js'), rd('checks.js'), rd('sqlkit.js')
shim, css = rd('web/shim.js').replace('/*@@BENCH@@*/', rd('web/bench.js')), rd('web/web.css')
supa = open(os.environ.get('SUPABASE_UMD', os.path.join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js')), encoding='utf-8').read()
for name, val in [('cpp', cpp), ('rt', rt), ('sqlk', sqlk), ('shim', shim), ('supa', supa)]:
    assert '</script' not in val.lower(), name

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (old[:80], n)
    s = s.replace(old, new)

# ---- comme la version potes : aucun contenu personnel ----
rep('/*@@SAESEEDS@@*/{}', '{}')
rep('/*@@SEEDS@@*/{}', '{}')
s = s.replace('/*@@SQLKIT@@*/', sqlk).replace('/*@@CHECKS@@*/', chk)
s = s.replace('/*@@CPP@@*/', cpp).replace('/*@@RUNTIME@@*/', rt)
rep('/*@@SNAPSHOT@@*/null', json.dumps({'root': 'but1', 'syncedAt': '1970-01-01T00:00:00Z', 'nodes': [{'id': 'but1', 'name': 'BUT 1', 'mime': 'application/vnd.google-apps.folder', 'parent': None}]}))
rep('/*@@FRIEND@@*/false', 'true')

# ---- branchements vers la couche web ----
rep("'but1:' + k", "(window.__web ? window.__web.ns : 'but1:') + k", 3)
rep("ROOT = FRIEND ? store.get('root', null) : SNAPSHOT.root;", "ROOT = window.__web ? 'but1' : FRIEND ? store.get('root', null) : SNAPSHOT.root;")
rep("async function afterSync() {", "async function afterSync() {\n  if (window.__web) return;")
rep("function shareSettings() {", "function shareSettings() {\n  if (window.__web) return window.__web.accountPanel();")
rep("if (FRIEND) $('#edtLink').hidden = true;", "if (FRIEND && !window.__web) $('#edtLink').hidden = true;")
rep("if (!EDT_URL || edtTried) return; edtTried = true;", "if ((!EDT_URL && !window.__web) || edtTried) return; edtTried = true;")
rep("const r = await fetch(EDT_URL, { cache: 'no-store', signal: ctl.signal }); if (!r.ok) return;",
    "const r = window.__web ? await window.__web.edtFetch(ctl.signal) : await fetch(EDT_URL, { cache: 'no-store', signal: ctl.signal }); if (!r.ok) return;")
rep("const fmtT = d =>", "if (window.__web) window.__web.edtRefresh = () => { edtTried = false; edtDirect = null; store.del('edt:direct'); edtTryDirect().then(() => { if (current && (current.kind === 'home' || current.kind === 'edt' || current.kind === 'evals')) route(); updateEvalCount(); }); };\nconst fmtT = d =>")
rep("$('#syncBtn').addEventListener('click', () => sync(true));", "$('#syncBtn').addEventListener('click', () => sync(true));\nif (window.__web) window.__web.resync = () => sync(false);")
# page emploi du temps : tuto + lien personnel
rep("el('div', { class: 'eyebrow', text: 'Celcat · groupe C' })", "el('div', { class: 'eyebrow', text: window.__web ? 'Celcat' : 'Celcat · groupe C' })")
rep("if (!d) { w.append(el('p', { class: 'muted', text: 'L\\'emploi du temps n\\'est pas encore arrivé",
    "if (!d && window.__web) { edtTryDirect(); w.append(window.__web.edtSetup(el, false)); return; }\n  if (!d) { w.append(el('p', { class: 'muted', text: 'L\\'emploi du temps n\\'est pas encore arrivé")
rep("(last ? ' · connu jusqu\\'au ' + fmtDay(last, { weekday: undefined }) : '') + '. Celcat → ton Drive deux fois par jour (7 h et 13 h).' }));",
    "(last ? ' · connu jusqu\\'au ' + fmtDay(last, { weekday: undefined }) : '') + (window.__web ? '.' : '. Celcat → ton Drive deux fois par jour (7 h et 13 h).') }));\n  if (window.__web) w.append(window.__web.edtSetup(el, true));")
rep("const d = edtData(); if (!d && !store.get('evals:manual', []).length) return null;",
    "const d = edtData(); if (!d && !store.get('evals:manual', []).length) return window.__web ? el('section', { class: 'edt-home w-edt-cta' }, el('h2', { class: 'home-h', text: 'Ton emploi du temps' }), el('p', { class: 'muted', text: 'Colle une fois le lien Celcat de ton emploi du temps : tes cours du jour et tes évaluations apparaîtront ici.' }), el('a', { class: 'btn primary', href: '#edt', text: 'Ajouter mon emploi du temps →' })) : null;")

rep('<div class="sec-label">Mon Drive</div>', '<div class="sec-label">Mes cours</div>')
rep("what: 'À préparer' };", "what: window.__web ? 'À faire' : 'À préparer' };")
rep("if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); toast('Enregistré automatiquement dans ce navigateur'); return; }",
    "if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (window.__web && o.node && !saveBtn.hidden && !saveBtn.disabled && ta.value !== (o.node.content || '')) { saveBtn.click(); return; } toast('Enregistré automatiquement dans ce navigateur'); return; }")
# ---- IA : intégrée si configurée (fonction « ia »), sinon la question part dans Claude ----
HIST = "thread.slice(-6).map(m => (m.role === 'user' ? 'Étudiant : ' + (m.show || m.content) : 'Tuteur : ' + m.content)).join('\\n\\n')"
rep("  api.ready = getSample().then(s => { api.ok = !!s && !sampleDead; return api.ok; });",
    "  api.ready = getSample().then(s => { api.ok = (!!s && !sampleDead) || !!window.__web; return api.ok; });")
rep("  async function ask(kind, arg) {\n    const s = await getSample();",
    "  async function ask(kind, arg) {\n    if (window.__web && !window.__web.iaOn) { if (kind === 'hint') hint = Math.min(hint + 1, 9); const { task } = TASKS[kind](arg); const hs = " + HIST + "; window.__web.handoff(TUTOR_RULES + '\\n\\n' + (await context(kind)) + (hs ? '### Échanges précédents\\n' + hs + '\\n\\n' : '') + '### Demande\\n' + task); save(); renderChips(); return; }\n    const s = await getSample();")
rep("        '<b>Bloqué ?</b> Demande un indice : je te guide pas à pas sans te donner la réponse toute faite.<br>' +",
    "        '<b>Bloqué ?</b> Demande un indice : je te guide pas à pas sans te donner la réponse toute faite.<br>' + (window.__web && !window.__web.iaOn ? 'Sur ce site, la réponse arrive dans CLAUDE_BRAND (ton compte gratuit suffit) : ta question est préparée avec le sujet et ton code.<br>' : '') +")
rep("    if (thread.length) chip('Nouvelle discussion',",
    "    if (window.__web && window.__web.iaOn && thread.length) chip('Continuer sur CLAUDE_BRAND ↗', async () => { const hs = " + HIST + "; window.__web.handoff(TUTOR_RULES + '\\n\\n' + (await context('free')) + '### Échanges précédents\\n' + hs + '\\n\\n### Demande\\nContinue à m\\'aider à partir de là, en respectant les règles.'); }, 'ghost');\n    if (thread.length) chip('Nouvelle discussion',")
rep("body.append(el('p', { class: 'err', text: msgs[code] || 'La connexion avec Claude a échoué. Réessaie.' }));",
    "body.append(el('p', { class: 'err', text: msgs[code] || (code === 'own' && e.message) || 'La connexion avec Claude a échoué. Réessaie.' }));")
rep("    async function ask(kind) {\n      const smp = await getSample(); if (!smp) { out.textContent = 'Claude n\\'est disponible que depuis claude.ai.'; return; }",
    "    async function ask(kind) {\n      const smp = await getSample();\n      if (!smp && window.__web) { const target = targetOf(); const task = kind === 'check' ? 'Vérifie si son code fait bien ' + target + ' : pour chaque consigne, dis ✅ fait / ⚠️ incomplet / ❌ manquant, avec la ligne concernée, puis les 2 ou 3 corrections les plus importantes expliquées simplement (sans tout réécrire).' : kind === 'hint' ? 'Il est bloqué sur ' + target + '. Donne UN indice pour la prochaine étape, sans donner la solution complète.' : 'Réponds à sa question : « ' + q.value.trim() + ' ». Appuie-toi sur son code (cite les lignes). Court et concret.'; window.__web.handoff((await context()) + '\\n\\n--- CONSIGNE ---\\n' + task); return; }\n      if (!smp) { out.textContent = 'Claude n\\'est disponible que depuis claude.ai.'; return; }")

# encadré « Aide de Claude » (dossiers avec sujet, et page Mes réponses des TD) quand l'IA n'est pas intégrée
rep("  if (isWebCtx(n) && !FRIEND) w.append(webPanel(n));", "  if (isWebCtx(n) && (!FRIEND || window.__web)) w.append(webPanel(n));")
rep("  w.append(prepBanner); if (prepPanel) w.append(prepPanel);",
    "  w.append(prepBanner); if (prepPanel) w.append(prepPanel);\n  if (window.__web && !window.__web.iaOn && pathOf(n).length >= 2 && !isWebCtx(n) && (n.kids.some(isSujet) || isRef)) w.append(window.__web.helpBox({ path: pathOf(n).map(x => x.name).join(' / '), docs: () => gatherDocs(n.id, 6), files: () => n.kids.filter(k => isCode(k) && k.content).slice(0, 6).map(k => '#### ' + k.name + '\\n```\\n' + k.content.slice(0, 4000) + '\\n```').join('\\n\\n') }));")
rep("  const w = el('div', { class: 'wrap wide' }); v.append(w);\n  const saveBtn = el('button', { class: 'btn', type: 'button', hidden: true, title: 'Enregistre tes réponses dans un fichier texte du dossier ' + f.name }",
    "  const w = el('div', { class: 'wrap wide' }); v.append(w);\n  if (window.__web && !window.__web.iaOn) setTimeout(() => { if (!w.isConnected || w.querySelector('.w-help')) return; const box = window.__web.helpBox({ path: pathOf(f).map(x => x.name).join(' / '), docs: () => gatherDocs(f.id, 6), answers: () => [...w.querySelectorAll('.td-ex')].map((c, i) => { const t = [...c.querySelectorAll('textarea')].map(x => x.value.trim()).filter(Boolean).join('\\n'); if (!t) return ''; const hh = c.querySelector('h2, h3, h4, .td-n, b'); return '#### ' + (hh ? hh.textContent.trim().slice(0, 80) : 'Exercice ' + (i + 1)) + '\\n' + t; }).filter(Boolean).join('\\n\\n') }); const hd = w.querySelector('.f-head'); if (hd) hd.after(box); else w.prepend(box); }, 0);\n  const saveBtn = el('button', { class: 'btn', type: 'button', hidden: true, title: 'Enregistre tes réponses dans un fichier texte du dossier ' + f.name }")

# ---- textes : plus de Google Drive ni de claude.ai ----
TXT = [
    ("'Ouvrir dans Drive ↗'", "'Télécharger ↓'"), ("'Dossier Drive ↗'", "'Télécharger (.zip) ↓'"), ("'Drive ↗'", "'Télécharger ↓'"),
    ("va dans la corbeille Drive (30 jours).", "est remplacée."),
    ("Copie du Drive", "Copie locale"), ("Drive synchronisé · ", "Synchronisé · "),
    ("version du Drive", "version en ligne"), ("Version Drive", "Version en ligne"), ("version Drive", "version en ligne"),
    ("tables de ton Drive", "tables du cours"), ("dans ton Drive", "dans ton espace"), ("de ton Drive", "de ton espace"), ("ton Drive", "ton espace"),
    ("(l\\'ancienne version va dans la corbeille Drive, récupérable 30 jours)", "(l\\'ancienne version est remplacée)"),
    (" · l\\'ancienne version est dans la corbeille Drive'", "'"),
    (" : avec Google Drive sur ton PC, tu le retrouves aussi dans VS Code.", " : tu peux le télécharger en .zip pour l\\'ouvrir dans VS Code."),
    ("'Chargement des fichiers depuis Drive…'", "'Chargement des fichiers…'"), ("'Créer un fichier dans le dossier Drive'", "'Créer un fichier dans ce dossier'"),
    ("'Téléchargement indisponible ici : ouvre le dossier Drive.'", "'Téléchargement indisponible.'"),
    ("(pn ? pn.name : 'Drive')", "(pn ? pn.name : 'ton espace')"),
    ("dans Drive", "en ligne"), ("sur Drive", "en ligne"), ("du Drive", "en ligne"), ("Document Drive", "Document"),
    ("Synchronise avec Drive", "Synchronise"), ("encadré Drive du menu", "encadré de synchronisation du menu"),
    ("le connecteur Google Drive doit être autorisé", "connexion au serveur nécessaire"),
    ("Google Drive n\\'est accessible que depuis claude.ai", "Le serveur ne répond pas"),
    ("(depuis claude.ai)", "(connexion au serveur nécessaire)"),
    (" : ouvre le site depuis claude.ai.", ", qui n\\'est pas activé sur ce site."),
    ("Il faut ouvrir le site depuis claude.ai.", "L\\'assistant IA n\\'est pas activé sur ce site."),
    ("Claude n\\'est disponible que depuis claude.ai.", "L\\'assistant IA n\\'est pas activé sur ce site."),
    ("réponse inattendue de Google Drive", "réponse inattendue du serveur"), ("Google Drive ne répond pas", "Le serveur ne répond pas"),
    ("Drive a refusé la demande", "le serveur a refusé la demande"),
]
main_start = s.index('<script>\n(function () {')
head, main = s[:main_start], s[main_start:]
for a, b in TXT:
    main = main.replace(a, b)
CL = [("Pose ta question à Claude…", "Pose ta question au tuteur…"), ("Question pour Claude", "Question pour le tuteur"), ("'Claude'", "'Tuteur'"),
      ("Aide de Claude", "Aide de l\\'IA"), ("Aide Claude", "Aide IA"), ("Ta session Claude a expiré", "Ta session a expiré"),
      ("Claude s\\'en sert quand il t\\'aide", "l\\'IA s\\'en sert quand elle t\\'aide"), ("et Claude pour", "et l\\'IA pour"),
      (" avec Claude", " avec l\\'IA"), (" par Claude", " par l\\'IA"), (" à Claude", " à l\\'IA"), (" de Claude", " de l\\'IA"),
      (", Claude ", ", l\\'IA "), (" et Claude te dit", " et l\\'IA te dit"), (" Claude les corrige", " l\\'IA les corrige"), (": Claude peut", ": l\\'IA peut"),
      ("Claude n\\'", "L\\'IA n\\'"), ("'Claude ", "'L\\'IA "), (">Claude ", ">L\\'IA "), ("\"Claude ", "\"L\\'IA ")]
for a, b in CL:
    main = main.replace(a, b)
main = main.replace('CLAUDE_BRAND', 'Claude')
s = head + main

# ---- rien de personnel dans la page publique ----
for a, b in [("Rédige la réponse de Rémi, étudiant", "Rédige la réponse de l\\'étudiant, étudiant"), ("Ce que Rémi veut dire", "Ce que l\\'étudiant veut dire"),
             (", signé « Rémi Monthus »", ", signé du prénom de l\\'étudiant"), ("const SHARE_ID = '1AFEarMzr312HqkR9ozMGsbW5ku_PNp-1';", "const SHARE_ID = '';")]:
    assert s.count(a) == 1, a
    s = s.replace(a, b)
assert 'Monthus' not in s and '1AFEarMzr' not in s
# ---- document HTML complet ----
app = s.index('<div class="app" id="app">')
headpart, bodypart = s[:app], s[app:]
headpart = headpart.replace('</style>', css + '\n</style>', 1) if '</style>' in headpart else headpart + '<style>' + css + '</style>'
# le script principal attend la connexion
rep_main = '<script>\n(function () {'
assert bodypart.count(rep_main) == 1
bodypart = bodypart.replace(rep_main, '<script type="text/x-atelier" id="atelier-main">\n(function () {')
first_script = bodypart.index('<script>')
pre = ('<script src="config.js"></script>\n<script>\n' + supa + '\n</script>\n<script>\n' + shim + '\n</script>\n')
bodypart = bodypart[:first_script] + pre + bodypart[first_script:]
html = ('<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="description" content="Ton espace BUT Informatique : cours, exercices C++ et web, emploi du temps.">\n'
        '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%230e4231%22/%3E%3Ctext x=%2232%22 y=%2243%22 font-size=%2230%22 text-anchor=%22middle%22 font-family=%22Arial%22 font-weight=%22700%22 fill=%22%23c9783b%22%3EB1%3C/text%3E%3C/svg%3E">\n'
        + headpart + '</head>\n<body>\n' + bodypart + '\n</body>\n</html>\n')
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
open(os.path.join(OUT, '.nojekyll'), 'w').write('')
if not os.path.exists(os.path.join(OUT, 'config.js')):
    open(os.path.join(OUT, 'config.example.js'), 'w', encoding='utf-8').write(rd('web/config.example.js'))
left = sorted(set(re.findall(r"'[^'\n]{0,60}\b(?:Drive|claude\.ai)\b[^'\n]{0,60}'", main)))
print(os.path.join(OUT, 'index.html'), len(html.encode()), '| textes Drive/claude.ai restants :', len(left))
if '-v' in sys.argv:
    for l in left: print('  ', l)
# ---- vérification : chaque script de la page doit être du JavaScript valide ----
import subprocess, tempfile
for m in re.finditer(r'<script(?: type="text/x-atelier" id="atelier-main")?>\n(.*?)</script>', html, re.S):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as t: t.write(m.group(1))
    r = subprocess.run(['node', '--check', t.name], capture_output=True, text=True); os.unlink(t.name)
    assert r.returncode == 0, r.stderr[:500]
print('scripts OK')
