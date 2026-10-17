/* Banc d'essai de l'IA (Administration → IA) : 4 cas tirés des vrais exercices, avec la réponse
   de référence écrite par Claude pour comparer. Inclus dans shim.js au moment du build. */
const BENCH_RULES = "Tu es le tuteur de programmation d'un étudiant débutant de BUT Informatique (1re année). Réponds en français, tutoiement, mots simples. Ne donne PAS le programme corrigé ni la ligne corrigée toute faite. Cite les lignes sous la forme « ligne 12 ». Sois court (120 mots maximum). Termine par une question ou une petite action concrète.";
const BENCH_CODE1 = "#include <iostream>\nusing namespace std;\n\nint main()\n{\n    int hauteur;\n    cout << \"Hauteur : \";\n    cin >> hauteur;\n    for (int ligne = 1; ligne <= hauteur; ligne++)\n    {\n        for (int etoile = 1; etoile < ligne; etoile++)\n            cout << \"*\";\n        cout << endl;\n    }\n    return 0;\n}";
const num = c => c.split('\n').map((l, i) => String(i + 1).padStart(3) + ' | ' + l).join('\n');
const BENCH_CODE2 = BENCH_CODE1.replace('cin >> hauteur;', 'cin >> hauteur');
const BENCH_HTML = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Mon club</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>Club de robotique</h1>\n<h3>Nos projets</h3>\n<img src="robot.jpg">\n<p style="color:red">Inscriptions ouvertes !</p>\n</body>\n</html>';
const words = t => String(t).trim().split(/\s+/).filter(Boolean).length;
const BENCH = [
  { id: 'hint', title: 'Indice sur un exercice (TP4, triangle d\'étoiles)',
    prompt: BENCH_RULES + "\n\n### Sujet\nExercice 1.1 : afficher un triangle rectangle d'étoiles de hauteur n saisie au clavier. La ligne k contient k étoiles.\n\n### Code de l'étudiant\n```cpp\n" + num(BENCH_CODE1) + "\n```\n\n### Console (saisie : 3)\n```\nHauteur : 3\n\n*\n**\n```\n\n### Demande\nIl demande un premier INDICE (niveau 1) : dis seulement où regarder et quelle question se poser.",
    checks: [
      ['Cite la ligne de la boucle (ligne 11)', t => /ligne\s*11\b/i.test(t)],
      ['Ne donne pas la ligne corrigée', t => !/etoile\s*<=\s*ligne/.test(t)],
      ['Court (150 mots max)', t => words(t) <= 150],
      ['Finit par une question ou une action', t => /\?\s*\**\s*$/.test(t.trim()) || /(essaie|teste|regarde|compte|calcule)[^.]*\.?\s*$/i.test(t.trim())]
    ],
    ref: "Regarde la **ligne 11** : c'est la boucle qui décide combien d'étoiles tu affiches sur chaque ligne. Avec une hauteur de 3, ta console montre une ligne vide, puis 1 étoile, puis 2 : il en manque **une à chaque fois**.\n\nPose-toi cette question : quand `ligne` vaut 1, combien de fois la boucle de la ligne 11 tourne-t-elle avec la condition que tu as écrite ? Fais le calcul à la main, puis compare avec le sujet (la ligne k contient k étoiles)." },
  { id: 'error', title: 'Expliquer une erreur de compilation',
    prompt: BENCH_RULES + "\n\n### Code de l'étudiant\n```cpp\n" + num(BENCH_CODE2) + "\n```\n\n### Compilation : ÉCHEC\nLigne 9 : « ; » attendu avant « for »\n\n### Demande\nExplique l'erreur : ce que veut dire le message en mots simples, pourquoi elle se produit ici (cite la ligne), comment la corriger dans le principe.",
    checks: [
      ['Parle du point-virgule', t => /point[- ]virgule|« ?; ?»|`;`/i.test(t)],
      ['Montre la bonne ligne (8, la ligne d\'avant)', t => /ligne\s*8\b/i.test(t)],
      ['Court (150 mots max)', t => words(t) <= 150]
    ],
    ref: "Le compilateur te dit qu'il attendait un **point-virgule** avant le mot `for`.\n\nEn C++, chaque instruction se termine par `;`. Le compilateur lit ton code dans l'ordre : il arrive au `for` de la ligne 9 alors que l'instruction précédente n'est pas finie. C'est pour ça qu'il signale la ligne 9, alors que l'oubli est juste avant, à la **ligne 8** (`cin >> hauteur`).\n\nRetiens le réflexe : quand une erreur dit « `;` attendu », regarde la **fin de la ligne d'avant**. Tu vois ce qui manque à la ligne 8 ?" },
  { id: 'quiz', title: 'Créer un quiz (réponse en JSON)', json: true,
    prompt: "Crée un quiz de 3 questions à choix multiples sur les boucles for en C++, niveau première année. Réponds en JSON avec ce format exact : {\"questions\": [{\"question\": \"…\", \"choix\": [\"…\", \"…\", \"…\", \"…\"], \"bonne\": 0, \"explication\": \"…\"}]} où « bonne » est l'indice (0 à 3) de la bonne réponse.",
    checks: [
      ['JSON valide', (t, j) => !!j],
      ['3 questions', (t, j) => j && Array.isArray(j.questions) && j.questions.length === 3],
      ['4 choix et une bonne réponse pour chacune', (t, j) => j && Array.isArray(j.questions) && j.questions.every(q => Array.isArray(q.choix) && q.choix.length === 4 && Number.isInteger(q.bonne) && q.bonne >= 0 && q.bonne < 4)],
      ['Une explication par question', (t, j) => j && Array.isArray(j.questions) && j.questions.every(q => String(q.explication || '').length > 10)]
    ],
    ref: JSON.stringify({ questions: [
      { question: "Combien de fois s'affiche « * » ? for (int i = 0; i < 5; i++) cout << \"*\";", choix: ['4', '5', '6', 'Une infinité'], bonne: 1, explication: "i prend les valeurs 0, 1, 2, 3, 4 : la condition i < 5 devient fausse quand i vaut 5, donc 5 tours." },
      { question: "Que vaut i après la boucle ? int i; for (i = 1; i <= 3; i++) {}", choix: ['1', '3', '4', '0'], bonne: 2, explication: "La boucle s'arrête quand i <= 3 devient faux, c'est-à-dire quand i vaut 4." },
      { question: "Quelle boucle affiche 10 9 8 … 1 ?", choix: ['for (int i = 10; i > 0; i--)', 'for (int i = 10; i >= 0; i--)', 'for (int i = 1; i <= 10; i++)', 'for (int i = 10; i > 0; i++)'], bonne: 0, explication: "On part de 10, on enlève 1 à chaque tour et on s'arrête avant 0. Avec i >= 0, on afficherait aussi 0 ; avec i++, la boucle ne s'arrêterait jamais." }
    ] }, null, 2) },
  { id: 'web', title: 'Vérifier un exercice web (bonnes pratiques du TD)',
    prompt: "Tu vérifies l'exercice HTML d'un étudiant débutant. Consignes de l'enseignant : 1) attribut lang sur <html> ; 2) alt sur chaque image ; 3) titres dans l'ordre h1 → h2 → h3 ; 4) aucune mise en forme dans le HTML (tout en CSS). Pour chaque consigne, dis ✅ fait / ❌ manquant, avec la ligne concernée. Puis les corrections les plus importantes, expliquées simplement, sans réécrire tout le fichier. Markdown court.\n\n```html\n" + num(BENCH_HTML) + "\n```",
    checks: [
      ['Utilise ✅ / ❌', t => /✅|❌/.test(t)],
      ['Voit le lang manquant (ligne 2)', t => /lang/i.test(t)],
      ['Voit le alt manquant (ligne 11)', t => /\balt\b/i.test(t)],
      ['Voit le h3 sans h2 (ligne 10)', t => /h2/i.test(t) && /h3/i.test(t)],
      ['Voit le style dans le HTML (ligne 12)', t => /style/i.test(t)]
    ],
    ref: "- ❌ **lang** (ligne 2) : `<html>` n'a pas d'attribut `lang`. Ajoute la langue de la page (ici le français).\n- ❌ **alt** (ligne 11) : l'image n'a pas de texte alternatif. Il sert aux lecteurs d'écran et s'affiche si l'image ne charge pas.\n- ❌ **ordre des titres** (ligne 10) : tu passes de `h1` à `h3` sans `h2`. Choisis le niveau selon la structure, pas selon la taille du texte.\n- ❌ **mise en forme dans le HTML** (ligne 12) : `style=\"color:red\"` doit aller dans `style.css`, avec une classe sur le paragraphe.\n\nCommence par le `lang` et le `alt` : ce sont les plus rapides à corriger." },
  { id: 'tree', title: 'Arbre d\'expression (priorités et parcours)',
    prompt: BENCH_RULES + "\n\n### Demande\nPour l'expression (a + b) * c - d / 2 : quelle est la racine de son arbre ? Décris les deux sous-arbres, puis donne le parcours préfixe et le parcours postfixe (éléments séparés par des espaces). C'est une correction autorisée : donne les réponses.",
    checks: [
      ['Racine = « - »', t => /racine[^.\n]{0,40}(«\s*-\s*»|`-`|\(-\)|moins|soustraction|\s-\s)/i.test(t)],
      ['Préfixe juste : - * + a b c / d 2', t => /-\s*\*\s*\+\s*a\s*b\s*c\s*\/\s*d\s*2/.test(t)],
      ['Postfixe juste : a b + c * d 2 / -', t => /a\s*b\s*\+\s*c\s*\*\s*d\s*2\s*\/\s*-/.test(t)]
    ],
    ref: "La **racine** est le `-` : c'est la dernière opération calculée, car `*` et `/` passent avant, et les parenthèses font calculer `a + b` en premier.\n\n- Sous-arbre gauche : `(a + b) * c`, avec `*` à sa racine ; à gauche le `+` (avec `a` et `b`), à droite `c`.\n- Sous-arbre droit : `d / 2`, avec `/` à sa racine, `d` à gauche et `2` à droite.\n\n**Préfixe** (racine, gauche, droite) : `- * + a b c / d 2`\n**Postfixe** (gauche, droite, racine) : `a b + c * d 2 / -`" },
];
function benchTab(body) {
  const status = h('div', { class: 'w-status', role: 'status' });
  const usage = h('p', { class: 'w-lead' });
  const run = h('button', { class: 'btn primary', type: 'button' }, 'Lancer le banc d\'essai (5 demandes)');
  const list = h('div', { class: 'w-bench' });
  W.iaUsage().then(u => { usage.textContent = 'Modèle : ' + (u.model || '?') + ' · ' + (u.used || 0) + ' / ' + (u.limit || '?') + ' demandes utilisées aujourd\'hui par ton compte.'; }).catch(() => { usage.textContent = 'La fonction « ia » ne répond pas : vérifie qu\'elle est déployée et que le secret IA_API_KEY est enregistré.'; });
  run.addEventListener('click', async () => {
    run.disabled = true; list.textContent = ''; let pass = 0, total = 0;
    for (const c of BENCH) {
      status.textContent = 'Cas « ' + c.title + ' »…';
      const t0 = performance.now(); let text = '', j = null, error = null, model = '';
      try { if (c.json) { j = await W.ia.json(c.prompt, { modelTier: 'default' }); text = JSON.stringify(j, null, 2); } else { const r = await W.ia(c.prompt, { modelTier: 'default' }); text = r.text; model = r.model; } }
      catch (e) { error = e.message || String(e); }
      const dt = ((performance.now() - t0) / 1000).toFixed(1);
      const res = c.checks.map(([label, f]) => { let ok = false; try { ok = !error && !!f(text, j); } catch (e) {} return [label, ok]; });
      pass += res.filter(r => r[1]).length; total += res.length;
      list.append(h('section', { class: 'w-sec' },
        h('h2', { class: 'w-h' }, c.title, h('span', { class: 'w-tag' }, res.filter(r => r[1]).length + '/' + res.length)),
        h('ul', { class: 'w-checks' }, res.map(([l, ok]) => h('li', { class: ok ? 'ok' : 'ko' }, (ok ? '✓ ' : '✗ ') + l))),
        h('div', { class: 'w-cmp' },
          h('div', null, h('div', { class: 'w-ref', text: (model || 'IA du site') + ' · ' + dt + ' s' }), h('pre', { class: 'w-ans', text: error ? 'Erreur : ' + error : text })),
          h('div', null, h('div', { class: 'w-ref', text: 'Claude (référence)' }), h('pre', { class: 'w-ans', text: c.ref })))));
    }
    status.textContent = 'Terminé : ' + pass + ' / ' + total + ' critères respectés. Lis aussi les réponses : les critères automatiques ne voient pas tout.';
    run.disabled = false;
    W.iaUsage().then(u => { usage.textContent = 'Modèle : ' + (u.model || '?') + ' · ' + (u.used || 0) + ' / ' + (u.limit || '?') + ' demandes utilisées aujourd\'hui par ton compte.'; }).catch(() => {});
  });
  body.append(h('section', { class: 'w-sec' }, h('h2', { class: 'w-h' }, 'Tester l\'IA du site'),
    h('p', { class: 'w-lead' }, 'Cinq demandes tirées de vrais exercices (indice, erreur, quiz, vérification web, arbre). Chaque réponse est notée sur des critères simples et affichée à côté de la réponse de Claude pour comparer.'),
    usage, h('div', { class: 'w-row' }, run)), status, list);
}
