/* Vérification d'un jeu d'essai : expect sur une ligne = « contient », sur plusieurs lignes = bloc de lignes consécutives exactes */
function checkTest(test, res) {
  if (res.err) return { ok: false, why: 'Erreur : ' + res.err.msg + (res.err.line ? ' (ligne ' + res.err.line + ')' : '') };
  if (res.timeout) return { ok: false, why: res.starved ? 'Le programme demande plus de saisies que le test n\'en fournit' : 'Le programme ne se termine pas (boucle infinie ?)' };
  const norm = s => String(s).replace(/\r/g, '');
  let exp = norm(test.expect).split('\n').map(l => l.replace(/\s+$/, ''));
  while (exp.length && !exp[0].trim()) exp.shift();
  while (exp.length && !exp[exp.length - 1].trim()) exp.pop();
  if (!exp.length) return { ok: true, why: '' };
  const out = norm(res.out);
  let ok;
  if (exp.length === 1) ok = out.includes(exp[0].trim());
  else {
    const lines = out.split('\n').map(l => l.replace(/\s+$/, ''));
    ok = false;
    for (let i = 0; i + exp.length <= lines.length && !ok; i++) {
      let m = true;
      for (let j = 0; j < exp.length; j++) {
        const a = lines[i + j], b = exp[j];
        if (a !== b) { m = false; break; }
      }
      ok = m;
    }
  }
  return { ok, why: ok ? '' : (res.starved ? 'Résultat attendu introuvable (et le programme a demandé plus de saisies que prévu)' : 'Résultat attendu introuvable dans l\'affichage') };
}
if (typeof module !== 'undefined') module.exports = checkTest;
