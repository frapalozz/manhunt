-- =====================================================================
-- Manhunt su Supabase: incolla tutto nel SQL Editor ed esegui (Run).
-- Puoi rieseguirlo senza problemi: crea solo ciò che manca.
-- PRIMA di eseguirlo cambia i due valori nella sezione "CONFIGURAZIONE" in fondo.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------- tabelle ----------
create table if not exists public.games (
  code text primary key,
  state jsonb not null,               -- stato completo della partita (giocatori, regole, tempi, eventi)
  rev integer not null default 0,     -- versione, per modifiche concorrenti sicure
  status text not null default 'lobby',
  updated_at timestamptz not null default now()
);

-- posizione privata di ogni giocatore: la scrive solo lui, il server la copia nei ping
create table if not exists public.locs (
  code text not null references public.games(code) on delete cascade,
  uid uuid not null,
  lat double precision not null,
  lng double precision not null,
  acc integer,
  t bigint,
  at timestamptz not null default now(),
  bg boolean not null default false,
  primary key (code, uid)
);

-- ping pubblicati dal server
create table if not exists public.pings (
  code text not null references public.games(code) on delete cascade,
  gid text not null,
  k integer not null,
  uid uuid not null,
  t bigint not null,
  lat double precision,
  lng double precision,
  acc integer,
  fix_at bigint,
  stale boolean not null default false,
  nofix boolean not null default false,
  primary key (code, gid, k, uid)
);

-- posizione dal vivo dei cercatori, visibile solo agli altri cercatori
create table if not exists public.seeker_pos (
  code text not null references public.games(code) on delete cascade,
  uid uuid not null,
  lat double precision not null,
  lng double precision not null,
  t bigint,
  gid text,
  primary key (code, uid)
);

-- iscrizioni alle notifiche push del browser
create table if not exists public.push_subs (
  endpoint text primary key,
  uid uuid not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_uid on public.push_subs(uid);

-- l'orario della posizione lo mette il database, non il telefono
create or replace function public.mh_set_at() returns trigger language plpgsql as $$
begin new.at := now(); return new; end $$;
drop trigger if exists locs_at on public.locs;
create trigger locs_at before insert or update on public.locs for each row execute function public.mh_set_at();

-- ---------- funzioni di supporto per le regole ----------
create or replace function public.mh_is_player(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.games g where g.code = c and g.state->'players' ? (auth.uid())::text)
$$;
create or replace function public.mh_role(c text) returns text
language sql stable security definer set search_path = public as $$
  select g.state->'players'->((auth.uid())::text)->>'role' from public.games g where g.code = c
$$;

-- ---------- sicurezza (Row Level Security) ----------
alter table public.games enable row level security;
alter table public.locs enable row level security;
alter table public.pings enable row level security;
alter table public.seeker_pos enable row level security;
alter table public.push_subs enable row level security;

drop policy if exists "games: i giocatori leggono" on public.games;
create policy "games: i giocatori leggono" on public.games for select to authenticated
  using (state->'players' ? ((select auth.uid())::text));
-- nessuna policy di scrittura: la partita la modifica solo la Edge Function

drop policy if exists "locs: proprietario" on public.locs;
create policy "locs: proprietario" on public.locs for all to authenticated
  using (uid = (select auth.uid()))
  with check (uid = (select auth.uid()) and public.mh_is_player(code));

drop policy if exists "pings: cercatori o propri" on public.pings;
create policy "pings: cercatori o propri" on public.pings for select to authenticated
  using (uid = (select auth.uid()) or public.mh_role(code) = 'seeker');

drop policy if exists "seeker_pos: leggono i cercatori" on public.seeker_pos;
create policy "seeker_pos: leggono i cercatori" on public.seeker_pos for select to authenticated
  using (public.mh_role(code) = 'seeker');
drop policy if exists "seeker_pos: scrive il cercatore" on public.seeker_pos;
create policy "seeker_pos: scrive il cercatore" on public.seeker_pos for insert to authenticated
  with check (uid = (select auth.uid()) and public.mh_role(code) = 'seeker');
drop policy if exists "seeker_pos: aggiorna il cercatore" on public.seeker_pos;
create policy "seeker_pos: aggiorna il cercatore" on public.seeker_pos for update to authenticated
  using (uid = (select auth.uid()))
  with check (uid = (select auth.uid()) and public.mh_role(code) = 'seeker');

drop policy if exists "push_subs: proprietario" on public.push_subs;
create policy "push_subs: proprietario" on public.push_subs for all to authenticated
  using (uid = (select auth.uid())) with check (uid = (select auth.uid()));

grant select on public.games, public.pings to authenticated;
grant select, insert, update on public.seeker_pos to authenticated;
grant select, insert, update, delete on public.locs, public.push_subs to authenticated;
revoke all on public.games, public.locs, public.pings, public.seeker_pos, public.push_subs from anon;

-- ---------- aggiornamenti in tempo reale ----------
do $$
declare t text;
begin
  foreach t in array array['games', 'pings', 'seeker_pos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- motore: ogni 5 secondi sveglia la Edge Function se c'è una partita in corso ----------
create schema if not exists mh_private;
revoke all on schema mh_private from public, anon, authenticated;
create table if not exists mh_private.config (key text primary key, value text not null);

create or replace function mh_private.kick() returns void
language plpgsql security definer set search_path = public, mh_private, extensions as $$
declare u text; s text;
begin
  if not exists (select 1 from public.games where status = 'running') then return; end if;
  select value into u from mh_private.config where key = 'function_url';
  select value into s from mh_private.config where key = 'tick_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tick-secret', s),
    body := jsonb_build_object('op', 'tick'),
    timeout_milliseconds := 10000
  );
end $$;

select cron.schedule('manhunt-tick', '5 seconds', 'select mh_private.kick()');

-- pulizia notturna: partite ferme da 2 giorni e utenti anonimi vecchi di 30 giorni
select cron.schedule('manhunt-cleanup', '17 3 * * *', $$
  delete from public.games where updated_at < now() - interval '2 days';
  delete from public.push_subs where created_at < now() - interval '60 days';
  delete from auth.users where is_anonymous and created_at < now() - interval '30 days';
  delete from net._http_response where created < now() - interval '1 day';
$$);

-- =====================================================================
-- CONFIGURAZIONE: sostituisci i due valori e riesegui solo questo blocco quando vuoi cambiarli.
--  function_url: https://<ID-PROGETTO>.supabase.co/functions/v1/manhunt
--  tick_secret:  la stessa frase segreta che metterai nel segreto TICK_SECRET della Edge Function
-- =====================================================================
insert into mh_private.config (key, value) values
  ('function_url', 'https://ID-PROGETTO.supabase.co/functions/v1/manhunt'),
  ('tick_secret', 'CAMBIA-QUESTA-FRASE-SEGRETA')
on conflict (key) do update set value = excluded.value;
