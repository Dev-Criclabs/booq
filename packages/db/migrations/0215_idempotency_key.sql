-- F03-T11 / migration 0215: Idempotency-Key storage. FA 2.4 (idempotency_key) and 3.5.
-- Requirement: BOOK-03-AC15 (with the second tap lookup in 0216). Decision D47.
--
-- A mutating route that takes an Idempotency-Key header does, in its transaction:
--   r := app.idempotency_begin(key, request_hash)   -- null: this request runs; else the stored response
--   ... do the work ...
--   app.idempotency_finish(key, response)
-- The same key sent in parallel waits on the first request's row, so the work runs once and every
-- caller gets the one response. The same key with another request body, or from another player, is
-- refused (idempotency_key_reused) and learns nothing. A request that fails rolls the row back, so
-- the key can be tried again. Rows older than seven days are purged by housekeeping (FA 5.4).

create table public.idempotency_key (
  club_id uuid not null references public.club (id),
  key text not null check (key <> '' and length(key) <= 200),
  user_id uuid not null,
  request_hash text not null check (request_hash <> ''),
  response jsonb,                          -- null only inside the request that claimed the key
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, key)
);
create index idempotency_key_age on public.idempotency_key (created_at);

alter table public.idempotency_key owner to booq_owner;
alter table public.idempotency_key enable row level security;
alter table public.idempotency_key force row level security;
revoke all on public.idempotency_key from public;
create policy idempotency_key_tenant on public.idempotency_key as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy idempotency_key_definer on public.idempotency_key for all to booq_owner using (true) with check (true);

select app.register_test_table('public.idempotency_key', 400);

create function app.idempotency_begin(p_key text, p_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  v_row public.idempotency_key%rowtype;
  v_inserted integer;
begin
  if v_club is null or v_user is null then perform app.refuse('sign_in_required'); end if;
  insert into public.idempotency_key (club_id, key, user_id, request_hash) values (v_club, p_key, v_user, p_hash)
    on conflict (club_id, key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return null;                            -- this request owns the key
  end if;
  select * into v_row from public.idempotency_key where club_id = v_club and key = p_key;
  if v_row.user_id <> v_user or v_row.request_hash <> p_hash or v_row.response is null then
    perform app.refuse('idempotency_key_reused');
  end if;
  return v_row.response;
end $$;
alter function app.idempotency_begin(text, text) owner to booq_owner;
revoke all on function app.idempotency_begin(text, text) from public;
grant execute on function app.idempotency_begin(text, text) to booq_app, booq_worker;

create function app.idempotency_finish(p_key text, p_response jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_response is null then raise exception 'idempotency_finish needs a response' using errcode = '22023'; end if;
  update public.idempotency_key set response = p_response
   where club_id = app.club_id() and key = p_key and user_id = app.user_id() and response is null;
  if not found then raise exception 'idempotency_finish: key not claimed by this request' using errcode = '22023'; end if;
end $$;
alter function app.idempotency_finish(text, jsonb) owner to booq_owner;
revoke all on function app.idempotency_finish(text, jsonb) from public;
grant execute on function app.idempotency_finish(text, jsonb) to booq_app, booq_worker;
