-- F01-T09 / migration 0012: LINE and payment connections and the club's stored secrets.
-- F01 design 3.2 and 6.3; FA 2.2 and 4.4. Requirements: PLAT-02-AC8, PDPA-01-AC9. D27, D32, D34.
-- Review SR-03 (blocking): the club comes from the context and never from an argument; who may
-- read which secret is decided by who may EXECUTE which function, not by a session setting; the
-- ciphertext is an asymmetric envelope made in the application (packages/secrets), so the
-- platform app holds only the public key.
--
-- Nothing here is granted to booq_platform yet: its grants and policies for these tables need the
-- platform helper functions of migration 0008 and are added once that is on main (follow-up).

create table public.line_connection (
  club_id uuid primary key references public.club (id),
  login_channel_id text,
  messaging_channel_id text,
  liff_id text,
  oa_basic_id text,
  line_plan_kind text,                       -- 'free' or 'paid'; LINE's API does not return it (P2 step 4)
  plan_message_limit integer,                -- null when unlimited or not set
  secret_last4 jsonb not null default '{}',  -- {kind: last four characters}, for masked display (D27)
  tested_at timestamptz,
  constraint line_plan_kind_values check (line_plan_kind in ('free', 'paid')),
  constraint line_plan_limit_positive check (plan_message_limit is null or plan_message_limit > 0)
);

-- Which Beam key set is in use follows the club status (D32); it is never typed, so there is no mode column.
create table public.payment_connection (
  club_id uuid primary key references public.club (id),
  merchant_id_test text,
  merchant_id_live text,
  webhook_token_hash_test text,              -- the URL token is shown once and kept only as a hash
  webhook_token_hash_live text,
  secret_last4 jsonb not null default '{}',
  tested_at timestamptz
);

create table public.club_secret (
  club_id uuid not null references public.club (id),
  kind text not null,
  ciphertext text not null,
  key_id text not null,
  written_by_staff uuid,                     -- platform staff id; foreign key added with the platform grants
  written_by_user uuid,
  written_at timestamptz not null default app.now(),
  primary key (club_id, kind),
  foreign key (club_id, written_by_user) references public.app_user (club_id, id),
  constraint club_secret_kind_values check (kind in (
    'line_channel_token', 'line_channel_secret', 'line_login_secret',
    'beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live')),
  -- A plaintext value can never be stored by mistake: the envelope has a fixed prefix.
  constraint club_secret_is_envelope check (ciphertext like 'booq1.%'),
  constraint club_secret_one_writer check (num_nonnulls(written_by_staff, written_by_user) = 1)
);

-- How often each secret was read, for monitoring; counts only, never a value (SR-03).
create table public.club_secret_read (
  club_id uuid not null references public.club (id),
  kind text not null,
  reads bigint not null default 0,
  last_read_at timestamptz,
  primary key (club_id, kind)
);

do $$
declare t text;
begin
  foreach t in array array['line_connection', 'payment_connection', 'club_secret', 'club_secret_read'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- The club's own admin reads the non-secret connection facts (the masked tails included).
create policy line_connection_read on public.line_connection for select to booq_app using (app.has_any_role('owner'));
create policy payment_connection_read on public.payment_connection for select to booq_app using (app.has_any_role('owner'));
grant select on public.line_connection, public.payment_connection to booq_app;
-- The ciphertext column is never granted to anyone but the definer functions: only the columns
-- that say a secret exists are readable.
create policy club_secret_meta on public.club_secret for select to booq_app using (app.has_any_role('owner'));
grant select (club_id, kind, key_id, written_at) on public.club_secret to booq_app;

-- Write: one function, so the last four characters are kept in step with the secret. The caller
-- passes the envelope made in the application, never the value. Owner of the club only for now.
create function app.write_secret(p_kind text, p_ciphertext text, p_key_id text, p_last4 text)
returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
begin
  if v_club is null then
    raise exception 'write_secret needs a club in the context' using errcode = 'P0001';
  end if;
  if v_user is null or not app.has_any_role('owner') then
    raise exception 'write_secret: not allowed' using errcode = '42501';
  end if;
  if p_last4 is null or length(p_last4) > 4 then
    raise exception 'write_secret: at most four characters may be kept for display' using errcode = 'P0001';
  end if;
  insert into public.club_secret as s (club_id, kind, ciphertext, key_id, written_by_user, written_by_staff, written_at)
    values (v_club, p_kind, p_ciphertext, p_key_id, v_user, null, app.now())
    on conflict (club_id, kind) do update
      set ciphertext = excluded.ciphertext, key_id = excluded.key_id,
          written_by_user = excluded.written_by_user, written_by_staff = null, written_at = excluded.written_at;
  if p_kind like 'line\_%' then
    insert into public.line_connection as c (club_id, secret_last4) values (v_club, jsonb_build_object(p_kind, p_last4))
      on conflict (club_id) do update set secret_last4 = c.secret_last4 || jsonb_build_object(p_kind, p_last4);
  else
    insert into public.payment_connection as c (club_id, secret_last4) values (v_club, jsonb_build_object(p_kind, p_last4))
      on conflict (club_id) do update set secret_last4 = c.secret_last4 || jsonb_build_object(p_kind, p_last4);
  end if;
end $$;

-- Read: the ciphertext of one secret of the club in the context, or null. Each caller role has
-- its own function and the allow-list is the set of kinds that function serves. A role that
-- cannot execute a function cannot read what it serves; nothing depends on a setting.
create function app.read_secret_internal(p_kind text, p_allowed text[])
returns text
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_cipher text;
begin
  if v_club is null then
    raise exception 'read_secret needs a club in the context' using errcode = 'P0001';
  end if;
  if p_kind is null or not (p_kind = any (p_allowed)) then
    raise exception 'read_secret: not allowed for this caller' using errcode = '42501';
  end if;
  select s.ciphertext into v_cipher from public.club_secret s where s.club_id = v_club and s.kind = p_kind;
  if v_cipher is not null then
    insert into public.club_secret_read as r (club_id, kind, reads, last_read_at) values (v_club, p_kind, 1, app.now())
      on conflict (club_id, kind) do update set reads = r.reads + 1, last_read_at = excluded.last_read_at;
  end if;
  return v_cipher;
end $$;

-- apps/web (booq_app): Beam (callback, Pay, QR) and the LINE channel secret that checks the webhook signature.
create function app.read_secret(p_kind text) returns text
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  select app.read_secret_internal(p_kind, array['beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live', 'line_channel_secret'])
$$;
-- apps/worker (booq_worker): Beam (reconcile) and every LINE secret (the sender, token refresh).
create function app.read_secret_worker(p_kind text) returns text
language sql security definer set search_path = pg_catalog, pg_temp
as $$
  select app.read_secret_internal(p_kind, array['beam_api_key_test', 'beam_hmac_key_test', 'beam_api_key_live', 'beam_hmac_key_live',
                                                'line_channel_token', 'line_channel_secret', 'line_login_secret'])
$$;

alter function app.write_secret(text, text, text, text) owner to booq_owner;
alter function app.read_secret_internal(text, text[]) owner to booq_owner;
alter function app.read_secret(text) owner to booq_owner;
alter function app.read_secret_worker(text) owner to booq_owner;
revoke all on function app.write_secret(text, text, text, text) from public;
revoke all on function app.read_secret_internal(text, text[]) from public;
revoke all on function app.read_secret(text) from public;
revoke all on function app.read_secret_worker(text) from public;
grant execute on function app.write_secret(text, text, text, text) to booq_app;
grant execute on function app.read_secret(text) to booq_app;
grant execute on function app.read_secret_worker(text) to booq_worker;

-- Audit: a write is an event, never a value (the ciphertext is a "set"/"changed" marker). The
-- masked tails are not secret (D27).
select audit.register('public.line_connection', array['club_id']);
select audit.register('public.payment_connection', array['club_id']);
select audit.register('public.club_secret', array['kind'], 'club_id', '{}', array['ciphertext']);
