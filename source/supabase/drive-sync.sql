-- ============================================================
--  Atelier BUT 1 — synchro automatique avec Google Drive
--  (à lancer après setup.sql ; relançable sans risque)
--  Remplace PROJET_REF ci-dessous par la référence du projet Supabase.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;
-- état de la synchro : une seule ligne. Lisible seulement côté serveur (fonction drive-sync).
create table if not exists public.sync_state (
  id          int primary key default 1 check (id = 1),
  folder_id   text,                 -- dossier « BUT 1 » sur Google Drive
  folder_name text,
  auto        boolean not null default true,
  sync_key    text not null default encode(extensions.gen_random_bytes(24), 'hex'), -- clé de la tâche planifiée
  last_run    timestamptz,
  last_ok     timestamptz,
  last_result jsonb
);
insert into public.sync_state (id) values (1) on conflict (id) do nothing;

-- quel fichier du site vient de quel fichier du Drive (et sa date de modification)
create table if not exists public.drive_map (
  file_id        text primary key,
  drive_id       text not null,
  drive_modified text,
  kind           text not null default 'file'
);

alter table public.sync_state enable row level security;
alter table public.drive_map  enable row level security;
revoke all on public.sync_state from anon, authenticated;
revoke all on public.drive_map  from anon, authenticated;

-- tâche planifiée : toutes les heures (minute 17)
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule('drive-sync') where exists (select 1 from cron.job where jobname = 'drive-sync');
select cron.schedule('drive-sync', '17 * * * *', $$
  select net.http_post(
    url     := 'https://PROJET_REF.supabase.co/functions/v1/drive-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', (select sync_key from public.sync_state where id = 1)),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000)
$$);
