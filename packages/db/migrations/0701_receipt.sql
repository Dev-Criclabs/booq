-- F13-T01 / migration 0701: receipt, receipt_void, receipt_counter. F13 design 3.1 and 3.2. Requirements: RCPT-01-AC1, AC2, AC9,
-- AC12, AC15; CC-1; decisions D4, D28, D33, D40, D106. Class D (BOOQ staff never).
--   * A receipt is a snapshot written once by app.issue_receipt (0702): the lines, methods and amounts as they were at issue time.
--     Nothing in it ever changes. The only change a row can have is the mark `void`, made by app.void_receipt (0704) and nothing
--     else: a trigger refuses every other update, whoever asks. Number, lines and total never change, not even in a void.
--   * One sale receipt per order (D40); one wallet-credit receipt per payment. Numbers are unique per club; the sequence number is
--     unique per club and series. A real series is the Bangkok year of issue ('2026'); the test series is 'T2026' (D4, D33).
--   * receipt_counter holds the last number taken per club and series. Only app.issue_receipt writes it, in the same transaction as
--     the receipt, so a rollback leaves no gap. No role has a grant on it.
--   * Test rows carry is_test (set by trigger from the club status) and go at Go live before the orders and payments they point
--     at; the real counter is untouched, so the first real receipt is 000001 (RCPT-01-AC15).

create table public.receipt (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  payment_id uuid,                             -- null for an order paid with no money (D64)
  kind text not null,
  series text not null,
  seq_no integer not null,
  number text not null,
  status text not null default 'issued',
  issued_at timestamptz not null default app.now(),
  vat_flag boolean not null,
  customer_id uuid,
  customer_name_snapshot text,
  lines jsonb not null,
  total_satang integer not null,
  is_test boolean not null default false,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  foreign key (club_id, order_id) references public.orders (club_id, id),
  foreign key (club_id, payment_id) references public.payment (club_id, id),
  constraint receipt_kind_values check (kind in ('sale', 'wallet_credit')),
  constraint receipt_status_values check (status in ('issued', 'void')),
  constraint receipt_series_shape check (series ~ '^T?[0-9]{4}$'),
  constraint receipt_series_test check ((left(series, 1) = 'T') = is_test),
  constraint receipt_seq_positive check (seq_no > 0),
  constraint receipt_total_not_negative check (total_satang >= 0),
  constraint receipt_lines_shape check (jsonb_typeof(lines) = 'object'),
  constraint receipt_wallet_credit_has_payment check (kind <> 'wallet_credit' or payment_id is not null),
  constraint receipt_number_unique unique (club_id, number),
  constraint receipt_seq_unique unique (club_id, series, seq_no)
);
-- One receipt per order for a sale (D40); one per payment for a wallet credit.
create unique index receipt_one_sale_per_order on public.receipt (club_id, order_id) where kind = 'sale';
create unique index receipt_one_credit_per_payment on public.receipt (club_id, payment_id) where kind = 'wallet_credit';
create index receipt_by_issue on public.receipt (club_id, issued_at desc);
create index receipt_by_customer on public.receipt (club_id, customer_id, issued_at desc) where customer_id is not null;

create table public.receipt_void (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  receipt_id uuid not null,
  reason text not null check (btrim(reason) <> ''),
  voided_by uuid not null,
  voided_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, receipt_id) references public.receipt (club_id, id),
  foreign key (club_id, voided_by) references public.app_user (club_id, id),
  constraint receipt_void_once unique (club_id, receipt_id)
);

create table public.receipt_counter (
  club_id uuid not null references public.club (id),
  series text not null,
  last_no integer not null check (last_no > 0),
  is_test boolean not null default false,
  primary key (club_id, series),
  constraint receipt_counter_series_shape check (series ~ '^T?[0-9]{4}$'),
  constraint receipt_counter_series_test check ((left(series, 1) = 'T') = is_test)
);

-- Append-only. The one allowed update is the void mark: status issued to void, nothing else different, and only from the
-- function's owner role (app.void_receipt is a definer function owned by booq_owner). Every other update, a delete and a
-- truncate are refused (the Go live purge may delete test rows through app.refuse_change, SR-15).
create function app.receipt_guard() returns trigger
language plpgsql set search_path = pg_catalog
as $$
begin
  if current_user = 'booq_owner'
     and old.status = 'issued' and new.status = 'void'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;
  raise exception 'a receipt is never edited; a correction is a void and a new receipt' using errcode = 'P0001';
end $$;
alter function app.receipt_guard() owner to booq_owner;
revoke all on function app.receipt_guard() from public;

create trigger receipt_no_edit before update on public.receipt for each row execute function app.receipt_guard();
create trigger receipt_no_delete before delete on public.receipt for each row execute function app.refuse_change();
create trigger receipt_no_truncate before truncate on public.receipt for each statement execute function app.refuse_change();
create trigger receipt_void_no_change before update or delete on public.receipt_void for each row execute function app.refuse_change();
create trigger receipt_void_no_truncate before truncate on public.receipt_void for each statement execute function app.refuse_change();

-- Rows, their security and who reads. The staff roles read the club's receipts (the accountant sees the name snapshot, D35);
-- a player reads their own. Nobody writes: app.issue_receipt and app.void_receipt are definer functions.
do $$
declare t text;
begin
  foreach t in array array['receipt', 'receipt_void', 'receipt_counter'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format('create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker using (club_id = app.club_id()) with check (club_id = app.club_id())', t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;
create policy receipt_staff_read on public.receipt for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy receipt_own_read on public.receipt for select to booq_app using (customer_id = app.user_id());
create policy receipt_worker_read on public.receipt for select to booq_worker using (true);
create policy receipt_void_staff_read on public.receipt_void for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy receipt_void_worker_read on public.receipt_void for select to booq_worker using (true);
grant select on public.receipt, public.receipt_void to booq_app, booq_worker;

-- Test receipts go at Go live, voids first, then receipts, then the counter, all before the payments (260) and orders (300) they use.
select app.register_test_table('public.receipt_void', 257);
select app.register_test_table('public.receipt', 258);
select app.register_test_table('public.receipt_counter', 259);
