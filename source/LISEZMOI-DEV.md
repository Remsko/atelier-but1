# Code source du site (pour reprendre le travail)

- `site.html` : le site complet (même code que la version claude.ai). `cpp.js`, `runtime.js`, `sqlkit.js`, `checks.js` : exécuteur C++, SQL, vérifications.
- `web/shim.js` : couche « vrai site » (comptes Supabase, fichiers, EDT, IA, administration). `web/bench.js` : banc d'essai IA. `web/web.css` : styles de cette couche.
- `build_web.py` : fabrique `../index.html`.
  1. `cd source && npm i @supabase/supabase-js@2.117.2` (ou mettre le fichier UMD dans `SUPABASE_UMD`)
  2. `python3 build_web.py` → écrit `index.html` à la racine du dépôt (GitHub Pages le publie).
- `supabase/setup.sql` : base (tables, règles de sécurité, compteurs IA) — relançable sans risque.
- `supabase/functions/{edt,admin,ia}/index.ts` : fonctions Edge (Verify JWT désactivé ; elles vérifient elles-mêmes la connexion).
  - `ia` : Claude via le secret `IA_API_KEY` (sk-ant-…) ; Haiku par défaut, Sonnet automatiquement pour SAE / lecture des sujets / demandes difficiles. Secrets facultatifs : `IA_MODEL`, `IA_MODEL_EXPERT`, `IA_EXPERT_DAILY` (0 = sans limite), `IA_DAILY_LIMIT` (80).
