-- Migration 0027: a shared sign-in rate-limit counter (orchestrator request; DevOps docs/ops/web.md).
-- The web servers are several processes, so the counter lives in the database. The key is an HMAC of the client
-- IP made by the caller with a key from configuration (no default); the IP is personal data and is never stored,
-- only the hash. One row per club, key and fixed window; app.hit_rate_limit counts a hit atomically and says
-- whether it is within the limit. The club comes from the context (SR-07), not from an argument. The limit and
-- the window length are arguments from configuration; nothing here chooses a number.
create table public.rate_limit_hit (
  club_id uuid not null references public.club (id),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (club_id, key_hash, window_start)
);
create index rate_limit_hit_by_window on public.rate_limit_hit (window_start);
alter table public.rate_limit_hit owner to booq_owner;
alter table public.rate_limit_hit enable row level security;
alter table public.rate_limit_hit force row level security;
revoke all on public.rate_limit_hit from public;
create policy rate_limit_hit_tenant on public.rate_limit_hit as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy rate_limit_hit_definer on public.rate_limit_hit for all to booq_owner using (true) with check (true);

create function app.hit_rate_limit(p_key_hash text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_start timestamptz;
  v_hits integer;
begin
  if v_club is null then
    raise exception 'hit_rate_limit needs a club in the context' using errcode = 'P0001';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hit_rate_limit: key_hash must be the 64 character hex HMAC of the client address' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'hit_rate_limit: limit must be a positive number' using errcode = 'P0001';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'hit_rate_limit: window must be a positive number of seconds' using errcode = 'P0001';
  end if;
  v_start := to_timestamp(floor(extract(epoch from app.now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_hit as r (club_id, key_hash, window_start, hits) values (v_club, p_key_hash, v_start, 1)
    on conflict (club_id, key_hash, window_start) do update set hits = r.hits + 1
    returning r.hits into v_hits;
  return v_hits <= p_limit;
end $$;
alter function app.hit_rate_limit(text, integer, integer) owner to booq_owner;
revoke all on function app.hit_rate_limit(text, integer, integer) from public;
grant execute on function app.hit_rate_limit(text, integer, integer) to booq_app;

-- Housekeeping for the worker: windows older than p_keep_seconds, in every club. It reads and returns no club data,
-- only deletes expired counters, so it takes no club from the context. The keep time comes from configuration.
create function app.sweep_rate_limit(p_keep_seconds integer) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
begin
  if p_keep_seconds is null or p_keep_seconds < 1 then
    raise exception 'sweep_rate_limit: keep time must be a positive number of seconds' using errcode = 'P0001';
  end if;
  delete from public.rate_limit_hit where window_start < app.now() - make_interval(secs => p_keep_seconds);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function app.sweep_rate_limit(integer) owner to booq_owner;
revoke all on function app.sweep_rate_limit(integer) from public;
grant execute on function app.sweep_rate_limit(integer) to booq_worker;
