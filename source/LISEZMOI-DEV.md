# Code source du site (pour reprendre le travail)

- `site.html` : le site complet (même code que la version claude.ai). `cpp.js`, `runtime.js`, `sqlkit.js`, `checks.js` : exécuteur C++, SQL, vérifications.
- `web/shim.js` : couche « vrai site » (comptes Supabase, fichiers, EDT, IA, administration). `web/bench.js` : banc d'essai IA. `web/web.css` : styles de cette couche.
- `build_web.py` : fabrique `../index.html`.
  1. `cd source && npm i @supabase/supabase-js@2.117.2` (ou mettre le fichier UMD dans `SUPABASE_UMD`)
  2. `python3 build_web.py` → écrit `index.html` à la racine du dépôt (GitHub Pages le publie).
- `supabase/setup.sql` : base (tables, règles de sécurité, compteurs IA) — relançable sans risque.
- `supabase/functions/{edt,admin,ia}/index.ts` : fonctions Edge (Verify JWT désactivé ; elles vérifient elles-mêmes la connexion).
  - `drive-sync` : copie le dossier « BUT 1 » de Google Drive dans la bibliothèque commune (fichiers nouveaux ou modifiés seulement, Google Docs → PDF, même tri que l'import manuel). Lecture par un compte de service Google : secret `GDRIVE_SA_JSON` (contenu du fichier .json), dossier partagé en lecture avec son adresse. Appelée toutes les heures par pg_cron (en-tête `x-sync-key`, voir `supabase/drive-sync.sql`) et par le bouton « Synchroniser maintenant » (Administration → Cours partagés).
  - `ia` : Claude via le secret `IA_API_KEY` (sk-ant-…) ; Haiku par défaut, Sonnet automatiquement pour SAE / lecture des sujets / demandes difficiles. Secrets facultatifs : `IA_MODEL`, `IA_MODEL_EXPERT`, `IA_EXPERT_DAILY` (0 = sans limite), `IA_DAILY_LIMIT` (80).
