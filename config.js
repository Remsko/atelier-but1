// Réglages du site. Copie ce fichier sous le nom « config.js » (même dossier que index.html)
// et remplace les deux valeurs par celles de ton projet Supabase :
// Supabase → Project Settings → API (ou « Connect ») : « Project URL » et la clé « anon / publishable ».
// Ces deux valeurs sont publiques (elles sont faites pour être dans un site web) : la sécurité
// vient des règles installées par setup.sql. Ne mets JAMAIS ici la clé « service_role » / « secret ».
// Sans config.js, le site marche en « mode local » (fichiers gardés dans le navigateur).
window.ATELIER_CONFIG = {
  supabaseUrl: 'https://hfyvzrmosccldtwhjgdk.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmeXZ6cm1vc2NjbGR0d2hqZ2RrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxODc2NjQsImV4cCI6MjEwNzc2MzY2NH0.trelVXdSC4ohTmxMNX_8tVfPGGz9iw1teJXPkp1WZnQ',
  // Comment un identifiant devient une adresse pour Supabase (personne ne reçoit de mail).
  // Si Supabase refuse de créer les comptes (« email invalide »), mets ton adresse Gmail
  // avec {login} après un + : 'ton.adresse+{login}@gmail.com'. Ne plus changer ensuite.
  loginPattern: '{login}@atelier-but1.invalid',
  // true une fois la fonction « ia » déployée et le secret IA_API_KEY enregistré (voir LISEZMOI, partie 4).
  // false : le tuteur prépare la question et l'ouvre dans Claude (compte gratuit de chacun).
  ia: false,
  siteName: 'Atelier BUT 1',
  adminContact: 'Remsko'                        // ex. 'Rémi (Discord : remi)' : affiché sur l'écran de connexion
};
