-- F05-T01 / migration 0401: payment. F05 design 4.3 and 5.1 to 5.6. Requirements: PAY-02, PAY-06-AC1,
-- AC2; decisions D72 (one pending charge per order), D76 (no personal data), D32 (key sets).
-- Class D. Written only by the definer functions of F05-T05 and the payment adapter (SR-07); the
-- app roles get read access by policy. No method can refund: there is no refund state (PAY-05).

create table public.payment (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  method text not null,
  status text not null default 'pending',
  environment text,                          -- which Beam key set: 'test' or 'live'; never mixed (PAY-01-AC4)
  gateway text,
  gateway_charge_id text,
  amount_satang integer not null,
  qr_image text,                             -- the stored base64 image; cleared when the payment is final
  qr_expires_at timestamptz,
  failure_code text,
  outcome text,
  cash_reason_code text,
  cash_reason_note text,
  taken_by uuid,                             -- the staff member who took cash
  confirmed_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, taken_by) references public.app_user (club_id, id),
  constraint payment_method_values check (method in ('beam', 'cash')),
  constraint payment_status_values check (status in ('pending', 'succeeded', 'failed', 'expired', 'cancelled')),
  constraint payment_environment_values check (environment in ('test', 'live')),
  constraint payment_outcome_values check (outcome in
    ('applied', 'applied_late', 'wallet_late', 'wallet_duplicate', 'wallet_cancelled', 'wallet_wrong_amount', 'mismatch', 'unknown')),
  constraint payment_amount_positive check (amount_satang > 0),
  constraint payment_cash_reason_values check (cash_reason_code in ('no_banking_app', 'qr_failed_at_counter', 'other')),
  -- Beam: gateway and environment; cash: neither, and a reason (PAY-06-AC1, AC2).
  constraint payment_beam_shape check (method <> 'beam' or (gateway = 'beam' and environment is not null and cash_reason_code is null and taken_by is null)),
  constraint payment_cash_shape check (method <> 'cash' or (
    gateway is null and gateway_charge_id is null and environment is null and qr_image is null
    and cash_reason_code is not null and taken_by is not null
    and (cash_reason_code <> 'other' or nullif(btrim(coalesce(cash_reason_note, '')), '') is not null))),
  constraint payment_succeeded_has_time check ((status = 'succeeded') = (confirmed_at is not null)),
  constraint payment_charge_unique unique (club_id, gateway, gateway_charge_id)
);
-- One pending Beam charge per order (D72): a second tap returns it, a new one waits for the first to fail.
create unique index payment_one_pending_beam on public.payment (club_id, order_id) where method = 'beam' and status = 'pending';
create index payment_by_order on public.payment (club_id, order_id, created_at desc);
create index payment_pending_expiry on public.payment (qr_expires_at) where status = 'pending';

-- The charge amount is the order's frozen money due, never a number the caller chooses (CC-2).
create function app.check_payment_amount() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare o public.orders%rowtype;
begin
  select * into o from public.orders where club_id = new.club_id and id = new.order_id;
  if not found or o.priced_at is null then
    raise exception 'payment: the order is not priced' using errcode = 'P0001';
  end if;
  if new.method = 'beam' and new.amount_satang <> o.money_satang then
    raise exception 'payment: a Beam charge is for the order''s money due' using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.check_payment_amount() owner to booq_owner;
revoke all on function app.check_payment_amount() from public;
create trigger payment_amount before insert on public.payment for each row execute function app.check_payment_amount();

-- A payment is never deleted (the purge deletes test payments only); its identity and amount never change.
create trigger payment_no_delete before delete on public.payment for each row execute function app.refuse_change();
create trigger payment_no_truncate before truncate on public.payment for each statement execute function app.refuse_change();
create function app.keep_payment_identity() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if new.club_id <> old.club_id or new.order_id <> old.order_id or new.method <> old.method
     or new.amount_satang <> old.amount_satang or new.environment is distinct from old.environment
     or new.gateway is distinct from old.gateway or new.created_at <> old.created_at then
    raise exception 'a payment''s order, method, amount and key set do not change' using errcode = 'P0001';
  end if;
  if old.status in ('succeeded', 'failed', 'cancelled') and new.status <> old.status then
    raise exception 'a % payment is final', old.status using errcode = 'P0001';
  end if;
  return new;
end $$;
alter function app.keep_payment_identity() owner to booq_owner;
revoke all on function app.keep_payment_identity() from public;
create trigger payment_identity before update on public.payment for each row execute function app.keep_payment_identity();

alter table public.payment owner to booq_owner;
alter table public.payment enable row level security;
alter table public.payment force row level security;
revoke all on public.payment from public;
create policy payment_tenant on public.payment as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy payment_definer on public.payment for all to booq_owner using (true) with check (true);
-- Reads: staff roles read the club's (the accountant sees amounts and orders, not contact details, D35);
-- a player reads the payments of their own orders (C11 polls the state). The worker reads in the club's context.
create policy payment_staff_read on public.payment for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy payment_own_read on public.payment for select to booq_app
  using (exists (select 1 from public.orders o where o.club_id = payment.club_id and o.id = payment.order_id and o.customer_id = app.user_id()));
create policy payment_worker_read on public.payment for select to booq_worker using (true);
grant select on public.payment to booq_app, booq_worker;

-- Test payments (Playground charges) go at Go live, before the orders they point at.
select app.register_test_table('public.payment', 260);
-- Audited, but the QR image is bulky and not a record of anything: only a marker is kept.
select audit.register('public.payment', array['id'], 'club_id', '{}', array['qr_image']);

-- An order paid in cash no longer needs payment (replaces the F04 version, 0304).
create or replace function app.order_needs_payment(p_order uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select (o.priced_at is null or o.money_satang > 0)
            and not exists (select 1 from public.payment p
                             where p.club_id = o.club_id and p.order_id = o.id and p.method = 'cash' and p.status = 'succeeded')
       from public.orders o where o.club_id = app.club_id() and o.id = p_order),
    true)
$$;
