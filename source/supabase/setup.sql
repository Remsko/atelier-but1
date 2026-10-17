-- ============================================================
--  Atelier BUT 1 — base de données (à coller une seule fois dans
--  Supabase → SQL Editor → New query → Run)
--  On peut le relancer sans risque : rien n'est effacé.
-- ============================================================

-- ---------- profils (un par compte) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  login        text unique,
  display_name text,
  is_admin     boolean not null default false,
  celcat_url   text,
  prefs        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- ---------- fichiers ----------
-- owner = null  : cours partagé (visible par tous les comptes, modifiable seulement par l'admin)
-- owner = un id : fichier personnel (visible seulement par son propriétaire)
create table if not exists public.files (
  id           text primary key default ('f' || replace(gen_random_uuid()::text, '-', '')),
  owner        uuid references auth.users on delete cascade,
  parent       text not null default '',
  name         text not null,
  mime         text not null default 'text/plain',
  content      text,
  storage_path text,
  size         bigint,
  modified     timestamptz not null default now(),
  constraint files_content_size check (content is null or octet_length(content) <= 3000000)
);
create index if not exists files_owner_idx  on public.files (owner);
create index if not exists files_parent_idx on public.files (parent);

-- un cours partagé qu'un compte a « supprimé » ou remplacé par sa propre version
create table if not exists public.hides (
  owner   uuid not null default auth.uid() references auth.users on delete cascade,
  file_id text not null,
  primary key (owner, file_id)
);

-- dossier racine commun
insert into public.files (id, owner, parent, name, mime)
values ('but1', null, '', 'BUT 1', 'application/vnd.google-apps.folder')
on conflict (id) do nothing;

-- ---------- qui est admin ? ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- profil créé automatiquement à chaque nouveau compte ; le tout premier compte devient admin
create or replace function public.on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, login, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'login', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    not exists (select 1 from public.profiles)
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.on_new_user();

-- comptes créés avant ce script
insert into public.profiles (id, login, display_name)
select u.id, split_part(u.email, '@', 1), split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;
update public.profiles set is_admin = true
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where is_admin);

-- ---------- sécurité : chacun ne voit que ses fichiers + les cours ----------
alter table public.profiles enable row level security;
alter table public.files    enable row level security;
alter table public.hides    enable row level security;

drop policy if exists "profil: lire" on public.profiles;
create policy "profil: lire" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profil: modifier" on public.profiles;
create policy "profil: modifier" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- on ne peut modifier que ces colonnes (pas is_admin ni login)
revoke update on public.profiles from authenticated, anon;
grant select on public.profiles to authenticated;
grant update (display_name, celcat_url, prefs) on public.profiles to authenticated;

drop policy if exists "fichiers: lire" on public.files;
create policy "fichiers: lire" on public.files for select to authenticated
  using (owner = auth.uid() or owner is null);
drop policy if exists "fichiers: ajouter" on public.files;
create policy "fichiers: ajouter" on public.files for insert to authenticated
  with check (owner = auth.uid() or (owner is null and public.is_admin()));
drop policy if exists "fichiers: modifier" on public.files;
create policy "fichiers: modifier" on public.files for update to authenticated
  using (owner = auth.uid() or (owner is null and public.is_admin()))
  with check (owner = auth.uid() or (owner is null and public.is_admin()));
drop policy if exists "fichiers: supprimer" on public.files;
create policy "fichiers: supprimer" on public.files for delete to authenticated
  using ((owner = auth.uid() or (owner is null and public.is_admin())) and id <> 'but1');
grant select, insert, update, delete on public.files to authenticated;
revoke all on public.files from anon;

drop policy if exists "masqués: les miens" on public.hides;
create policy "masqués: les miens" on public.hides for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
grant select, insert, delete on public.hides to authenticated;
revoke all on public.hides from anon;
revoke all on public.profiles from anon;

-- ---------- stockage des PDF et images ----------
-- « cours » : PDF partagés (lecture pour tous les comptes, écriture admin)
-- « perso » : images et fichiers binaires de chacun, rangés dans un dossier à son id
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('cours', 'cours', false) on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('perso', 'perso', false) on conflict (id) do nothing;
    execute 'drop policy if exists "cours: lire" on storage.objects';
    execute 'create policy "cours: lire" on storage.objects for select to authenticated using (bucket_id = ''cours'')';
    execute 'drop policy if exists "cours: admin" on storage.objects';
    execute 'create policy "cours: admin" on storage.objects for all to authenticated using (bucket_id = ''cours'' and public.is_admin()) with check (bucket_id = ''cours'' and public.is_admin())';
    execute 'drop policy if exists "perso: les miens" on storage.objects';
    execute 'create policy "perso: les miens" on storage.objects for all to authenticated using (bucket_id = ''perso'' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = ''perso'' and (storage.foldername(name))[1] = auth.uid()::text)';
  end if;
end $$;

-- ---------- assistant IA : quota quotidien par compte ----------
create table if not exists public.ia_usage (
  owner uuid not null references auth.users on delete cascade,
  day   date not null default current_date,
  count int  not null default 0,
  primary key (owner, day)
);
alter table public.ia_usage enable row level security;
drop policy if exists "ia: mon compteur" on public.ia_usage;
create policy "ia: mon compteur" on public.ia_usage for select to authenticated using (owner = auth.uid());
grant select on public.ia_usage to authenticated;
revoke all on public.ia_usage from anon;
-- appelée seulement par la fonction « ia » (clé serveur) : +1 et renvoie le total du jour
create or replace function public.ia_take(p_owner uuid) returns int
language sql security definer set search_path = public as $$
  insert into public.ia_usage (owner, day, count) values (p_owner, current_date, 1)
  on conflict (owner, day) do update set count = public.ia_usage.count + 1
  returning count
$$;
revoke execute on function public.ia_take(uuid) from public, anon, authenticated;

-- ---------- assistant IA : compteur des réponses du modèle « expert » (Sonnet) ----------
alter table public.ia_usage add column if not exists expert int not null default 0;
create or replace function public.ia_take_expert(p_owner uuid) returns int
language sql security definer set search_path = public as $$
  insert into public.ia_usage (owner, day, count, expert) values (p_owner, current_date, 0, 1)
  on conflict (owner, day) do update set expert = public.ia_usage.expert + 1
  returning expert
$$;
revoke execute on function public.ia_take_expert(uuid) from public, anon, authenticated;
