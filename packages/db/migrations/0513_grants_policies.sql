-- F06-T11 / migration 0513: who reads what of F06, and an expiry fix. F06 design 7 and 10; FA 4.3.
-- Requirements: PKG-01, PKG-03-AC3, CC-1, CC-3; decisions D27, D33, D35, D103, D118.
--
-- 1. An extended package expires again (orchestrator, 30 Oct; D118): a credit returned to an expired package by a
--    closure (CANCEL-03-AC12) stays usable only until the owner's new expiry date. The expire key now carries the
--    expiry instant, expire:{package}:{expires_at in UTC}, so each expiry date writes its remainder off once.
-- 2. Reads. Every F06 write goes through the definer functions; the app roles only read, by these policies:
--      package_product (class S)   the club's people read; the owner adds and edits (no delete: a sold product stays);
--                                  BOOQ staff as for every setup table (support view, D27); a guest reads nothing here
--                                  (the public columns of D103 come through the route of F06-T15)
--      customer_package, package_extension, wallet_account, credit_ledger, wallet_ledger (class D)
--                                  a person reads their own; front desk, owner and accountant read the club's (the
--                                  accountant needs amounts for the value owed report and sees names only through
--                                  public.app_user_names, never phone or date of birth, D35); BOOQ staff nothing
--      wallet_balance, package_balance, package_status
--                                  the same rule inside each view (they run as their owner)
--    The worker reads all of the club in its context (jobs, the webhook).

-- 1. Expiry once per expiry date.
create or replace function app.credit_expire(p_package uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  p public.customer_package%rowtype;
  v_left integer;
begin
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package;
  if not found then
    raise exception 'credit:package_not_found' using errcode = 'P0001';
  end if;
  perform app.lock_customer(p.customer_id);
  select * into p from public.customer_package cp where cp.club_id = v_club and cp.id = p_package for update;
  if p.expires_at > app.now() then
    return 0;
  end if;
  v_left := app.package_credits_left(p_package);
  if v_left <= 0 then
    return 0;
  end if;
  insert into public.credit_ledger (club_id, package_id, change, reason, dedupe_key)
    values (v_club, p_package, -v_left, 'expire', app.package_expire_key(p_package, p.expires_at))
    on conflict (club_id, dedupe_key) do nothing;
  if not found then
    return 0;
  end if;
  return v_left;
end $$;

create function app.package_expire_key(p_package uuid, p_expires_at timestamptz) returns text
language sql immutable set search_path = pg_catalog
as $$ select 'expire:' || p_package::text || ':' || to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
alter function app.package_expire_key(uuid, timestamptz) owner to booq_owner;
revoke all on function app.package_expire_key(uuid, timestamptz) from public;

create or replace function app.due_package_expiry(p_limit integer default 200)
returns table (club_id uuid, package_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.club_id, p.id
      from public.customer_package p
      join public.club c on c.id = p.club_id
     where p.expires_at <= app.now()
       and c.status <> 'paused'
       and p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l
                                        where l.club_id = p.club_id and l.package_id = p.id), 0) > 0
       and not exists (select 1 from public.credit_ledger e
                        where e.club_id = p.club_id and e.dedupe_key = app.package_expire_key(p.id, p.expires_at))
     order by p.expires_at, p.id
     limit greatest(1, p_limit);
end $$;

-- 2. Reads.
-- Who may read a customer's F06 rows: the person, or the club's front desk, owner or accountant.
create function app.may_read_customer_value(p_customer uuid) returns boolean
language sql stable set search_path = pg_catalog
as $$ select p_customer = app.user_id() or app.has_any_role('owner', 'front_desk', 'accountant') $$;
alter function app.may_read_customer_value(uuid) owner to booq_owner;
revoke all on function app.may_read_customer_value(uuid) from public;
grant execute on function app.may_read_customer_value(uuid) to booq_app, booq_worker;

-- package_product: the club's people read, the owner writes; BOOQ staff as for the price tables (0305).
create policy package_product_read on public.package_product for select to booq_app
  using (app.has_any_role('player', 'coach', 'front_desk', 'accountant', 'owner'));
create policy package_product_worker_read on public.package_product for select to booq_worker using (true);
create policy package_product_owner on public.package_product for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
grant select on public.package_product to booq_app, booq_worker;
grant insert, update on public.package_product to booq_app;
grant select, insert, update on public.package_product to booq_platform;
create policy package_product_platform_read on public.package_product for select to booq_platform using (platform.can_see_club(club_id));
create policy package_product_platform_write on public.package_product for all to booq_platform
  using (platform.can_see_club(club_id) and platform.club_editable(club_id))
  with check (platform.can_see_club(club_id) and platform.club_editable(club_id));

create policy customer_package_read on public.customer_package for select to booq_app
  using (app.may_read_customer_value(customer_id));
create policy wallet_account_read on public.wallet_account for select to booq_app
  using (app.may_read_customer_value(customer_id));
create policy wallet_ledger_read on public.wallet_ledger for select to booq_app
  using (app.may_read_customer_value(customer_id));
create policy credit_ledger_read on public.credit_ledger for select to booq_app
  using (exists (select 1 from public.customer_package p
                  where p.club_id = credit_ledger.club_id and p.id = credit_ledger.package_id and app.may_read_customer_value(p.customer_id)));
create policy package_extension_read on public.package_extension for select to booq_app
  using (exists (select 1 from public.customer_package p
                  where p.club_id = package_extension.club_id and p.id = package_extension.package_id and app.may_read_customer_value(p.customer_id)));
do $$
declare t text;
begin
  foreach t in array array['customer_package', 'package_extension', 'wallet_account', 'credit_ledger', 'wallet_ledger'] loop
    execute format('create policy %1$s_worker_read on public.%1$I for select to booq_worker using (true)', t);
    execute format('grant select on public.%I to booq_app, booq_worker', t);
  end loop;
end $$;

-- The views carry the same rule (they run as their owner). Callers that are not booq_app see the club's.
create or replace view public.wallet_balance with (security_barrier = true) as
select l.club_id, l.customer_id, sum(l.change_satang)::bigint as balance_satang
  from public.wallet_ledger l
 where l.club_id = app.club_id()
   and (coalesce(current_setting('role', true), '') <> 'booq_app' or app.may_read_customer_value(l.customer_id))
 group by l.club_id, l.customer_id;

create or replace view public.package_balance with (security_barrier = true) as
select p.club_id, p.id as package_id, p.customer_id,
       (p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l
                                     where l.club_id = p.club_id and l.package_id = p.id), 0))::integer as credits_left
  from public.customer_package p
 where p.club_id = app.club_id()
   and (coalesce(current_setting('role', true), '') <> 'booq_app' or app.may_read_customer_value(p.customer_id));

grant select on public.wallet_balance, public.package_balance, public.package_status to booq_app, booq_worker;
