-- F06-T02 / migration 0502: credit_ledger and wallet_ledger. F06 design 3.1 and 3.2; FA 2.3, 10.1 Q4, Q5.
-- Requirements: PKG-01-AC1 to AC3, AC5, AC7; decisions D28, D78, D83.
--
-- Credits and wallet are movements, never one editable number. A balance is the sum of its rows
-- (views in 0503). Append-only three ways (FA 2.3): no application role holds UPDATE, DELETE or
-- TRUNCATE, a trigger refuses them for everyone including the owner, and RLS is forced. A
-- deferred trigger refuses, at commit, any transaction that leaves a balance below zero (D83);
-- the writing functions (0505 to 0508) check first under a lock, this is the backstop.
-- The reason import_transfer (D154) is added to both reason checks by 0510 (F06-T08).
-- Grants and read policies are F06-T11 (0513); the definer functions are the only writers.

create table public.credit_ledger (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  package_id uuid not null,
  change integer not null,
  reason text not null,
  booking_id uuid,
  order_line_id uuid,                     -- the line whose credit part this reserves or returns
  staff_id uuid,
  note text,
  dedupe_key text,                        -- e.g. 'reserve:{order_line}:{attempt}', 'use:{booking}'
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, package_id) references public.customer_package (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, order_line_id) references public.order_line (club_id, id),
  foreign key (club_id, staff_id) references public.app_user (club_id, id),
  constraint credit_ledger_reason_values check (reason in ('reserve', 'return', 'use', 'forfeit', 'expire', 'adjust', 'import')),
  -- Sign rules (FA 10.1 Q4): reserve -1, return +1, use and forfeit 0, expire the negative remainder,
  -- adjust and import signed and never zero.
  constraint credit_ledger_sign check (case reason
    when 'reserve' then change = -1
    when 'return' then change = 1
    when 'use' then change = 0
    when 'forfeit' then change = 0
    when 'expire' then change < 0
    else change <> 0 end),
  -- Staff always give a written reason; an adjustment is always a staff action (PKG-01-AC4).
  constraint credit_ledger_staff_note check (staff_id is null or nullif(btrim(coalesce(note, '')), '') is not null),
  constraint credit_ledger_adjust_by_staff check (reason <> 'adjust' or staff_id is not null),
  constraint credit_ledger_dedupe unique (club_id, dedupe_key)     -- nulls are distinct
);
create index credit_ledger_by_package on public.credit_ledger (club_id, package_id, created_at);
create index credit_ledger_by_booking on public.credit_ledger (club_id, booking_id) where booking_id is not null;
create index credit_ledger_by_line on public.credit_ledger (club_id, order_line_id) where order_line_id is not null;

create table public.wallet_ledger (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  change_satang bigint not null check (change_satang <> 0),
  reason text not null,
  booking_id uuid,
  order_id uuid,
  order_line_id uuid,                     -- the line whose wallet part this spends or returns
  payment_id uuid,                        -- the payment behind a late, wrong or duplicate payment (D37)
  referral_id uuid,                       -- plain uuid until F14 creates the referral table
  staff_id uuid,
  note text,
  dedupe_key text,                        -- e.g. 'late_payment:{payment}', 'spend:{order_line}:{attempt}'
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, customer_id) references public.app_user (club_id, id),
  foreign key (club_id, booking_id) references public.booking (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, order_line_id) references public.order_line (club_id, id),
  foreign key (club_id, payment_id) references public.payment (club_id, id),
  foreign key (club_id, staff_id) references public.app_user (club_id, id),
  -- The D78 set; 'expire' is written only by app.wallet_expire when the club set an expiry (D89, 0508).
  constraint wallet_ledger_reason_values check (reason in
    ('refund', 'late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'spend', 'return', 'adjust', 'import', 'expire')),
  -- Money in is positive, spend and expire negative, a staff adjustment either way.
  constraint wallet_ledger_sign check (case reason
    when 'spend' then change_satang < 0
    when 'expire' then change_satang < 0
    when 'adjust' then true
    else change_satang > 0 end),
  constraint wallet_ledger_staff_note check (staff_id is null or nullif(btrim(coalesce(note, '')), '') is not null),
  constraint wallet_ledger_adjust_by_staff check (reason <> 'adjust' or staff_id is not null),
  constraint wallet_ledger_spend_has_line check (reason <> 'spend' or (order_id is not null and order_line_id is not null)),
  constraint wallet_ledger_dedupe unique (club_id, dedupe_key)
);
create index wallet_ledger_by_customer on public.wallet_ledger (club_id, customer_id, created_at);
create index wallet_ledger_by_order on public.wallet_ledger (club_id, order_id) where order_id is not null;
create index wallet_ledger_by_line on public.wallet_ledger (club_id, order_line_id) where order_line_id is not null;

-- Append-only (PKG-01-AC5, D28). refuse_change lets only booq_purge delete is_test rows (Go live).
create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function app.refuse_change();
create trigger credit_ledger_no_truncate before truncate on public.credit_ledger
  for each statement execute function app.refuse_change();
create trigger wallet_ledger_append_only before update or delete on public.wallet_ledger
  for each row execute function app.refuse_change();
create trigger wallet_ledger_no_truncate before truncate on public.wallet_ledger
  for each statement execute function app.refuse_change();

-- Backstop at commit: no package below zero credits, no wallet below zero satang (PKG-01-AC7, D83).
create function app.check_credit_balance() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare v_left bigint;
begin
  select p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l
                                       where l.club_id = p.club_id and l.package_id = p.id), 0)
    into v_left
    from public.customer_package p where p.club_id = new.club_id and p.id = new.package_id;
  if v_left < 0 then
    raise exception 'ledger: credits below zero' using errcode = 'P0001';
  end if;
  return null;
end $$;
alter function app.check_credit_balance() owner to booq_owner;
revoke all on function app.check_credit_balance() from public;
create constraint trigger credit_ledger_not_negative after insert on public.credit_ledger
  deferrable initially deferred for each row execute function app.check_credit_balance();

create function app.check_wallet_balance() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if (select sum(change_satang) from public.wallet_ledger
       where club_id = new.club_id and customer_id = new.customer_id) < 0 then
    raise exception 'ledger: wallet below zero' using errcode = 'P0001';
  end if;
  return null;
end $$;
alter function app.check_wallet_balance() owner to booq_owner;
revoke all on function app.check_wallet_balance() from public;
create constraint trigger wallet_ledger_not_negative after insert on public.wallet_ledger
  deferrable initially deferred for each row execute function app.check_wallet_balance();

do $$
declare t text;
begin
  foreach t in array array['credit_ledger', 'wallet_ledger'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- Purge order: the ledgers go before bookings (200), order lines (150), payments (260) and packages (270).
select app.register_test_table('public.credit_ledger', 140);
select app.register_test_table('public.wallet_ledger', 140);

select audit.register('public.credit_ledger', array['id']);
select audit.register('public.wallet_ledger', array['id']);
