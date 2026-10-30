-- F13-T02 / migration 0702: app.issue_receipt(order, payment, kind). F13 design 4.1, 3.2. Requirements: RCPT-01-AC1 to AC6, AC14,
-- AC15; RCPT-02-AC11; decisions D4, D33, D37, D64, D74, D79, D106, D112; contract docs/architecture/apply-payment.md (port issue_receipt).
--   * Builds the snapshot from the order, its lines and its succeeded payments, takes the next number of the series, writes the
--     receipt. All in the caller's transaction, with the counter lock taken last (FA 3.4: order, bookings, payment, counter), so a
--     rollback leaves no gap and a confirmation that stands always has its number.
--   * Idempotent: a sale receipt exists once per order, a wallet credit receipt once per payment; a repeated call returns it.
--   * Real series: the Bangkok year of issue, numbered {club prefix}-{year}-{six digits}, restarting each year. A test order (a club
--     in Testing) takes the T series, numbered TEST-{year}-{six digits}, which never touches the real counter and needs no prefix.
--     A real receipt with no club prefix raises receipt:prefix_missing and rolls the payment back (Go live is blocked on the prefix).
--   * Called only by the payment functions that own the transaction (apply_payment, take_cash, complete_zero_money_order, the wallet
--     credit paths) as the table owner, so no role is granted execute. The design lists the worker and the app role; the payment
--     functions are definers, and a direct grant would let any caller probe orders for nothing.
--   * Errors are receipt:<code> (P0001): no_club, invalid_kind, order_not_found, wrong_order_kind, no_payment, payment_not_confirmed,
--     order_not_paid, prefix_missing.

create function app.issue_receipt(p_order uuid, p_payment uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_kind text;
  o public.orders%rowtype;
  pay public.payment%rowtype;
  v_existing uuid;
  v_test boolean;
  v_prefix text;
  v_year text;
  v_series text;
  v_no integer;
  v_number text;
  v_vat boolean;
  v_name text;
  v_lines jsonb;
  v_id uuid;
begin
  if v_club is null then
    raise exception 'receipt:no_club' using errcode = 'P0001';
  end if;
  if p_kind = 'order' then v_kind := 'sale';
  elsif p_kind = 'wallet_credit' then v_kind := 'wallet_credit';
  else
    raise exception 'receipt:invalid_kind' using errcode = 'P0001';
  end if;
  select * into o from public.orders where club_id = v_club and id = p_order;
  if not found then
    raise exception 'receipt:order_not_found' using errcode = 'P0001';
  end if;
  if o.kind <> v_kind then
    raise exception 'receipt:wrong_order_kind' using errcode = 'P0001';
  end if;

  if v_kind = 'sale' then
    select r.id into v_existing from public.receipt r where r.club_id = v_club and r.order_id = p_order and r.kind = 'sale';
    if found then return v_existing; end if;
    if p_payment is null then
      if o.money_satang is distinct from 0 then
        raise exception 'receipt:no_payment' using errcode = 'P0001';
      end if;
      if o.status <> 'paid' then
        raise exception 'receipt:order_not_paid' using errcode = 'P0001';
      end if;
    else
      select * into pay from public.payment p where p.club_id = v_club and p.id = p_payment;
      if not found or pay.order_id <> p_order or pay.status <> 'succeeded' then
        raise exception 'receipt:payment_not_confirmed' using errcode = 'P0001';
      end if;
    end if;
  else
    if p_payment is null then
      raise exception 'receipt:no_payment' using errcode = 'P0001';
    end if;
    select r.id into v_existing from public.receipt r where r.club_id = v_club and r.payment_id = p_payment and r.kind = 'wallet_credit';
    if found then return v_existing; end if;
    select * into pay from public.payment p where p.club_id = v_club and p.id = p_payment;
    if not found or pay.status <> 'succeeded' then
      raise exception 'receipt:payment_not_confirmed' using errcode = 'P0001';
    end if;
  end if;

  v_test := o.is_test;
  v_year := extract(year from app.now() at time zone 'Asia/Bangkok')::int::text;
  if v_test then
    v_prefix := 'TEST';
    v_series := 'T' || v_year;
  else
    select btrim(c.receipt_prefix) into v_prefix from public.club c where c.id = v_club;
    if v_prefix is null or v_prefix = '' then
      raise exception 'receipt:prefix_missing' using errcode = 'P0001';
    end if;
    v_series := v_year;
  end if;

  -- The snapshot: what was sold, how it was paid, and the club's VAT switch, as at this moment.
  select coalesce((select s.value = 'true'::jsonb from public.club_setting s where s.club_id = v_club and s.key = 'vat_enabled'), false) into v_vat;
  select coalesce(u.full_name, u.display_name) into v_name from public.app_user u where u.club_id = v_club and u.id = o.customer_id;
  v_lines := jsonb_build_object(
    'order', jsonb_build_object('id', o.id, 'kind', o.kind, 'subtotal_satang', o.subtotal_satang, 'discount_satang', o.discount_satang, 'total_satang', o.total_satang,
                                'credit_value_satang', o.credit_value_satang, 'wallet_satang', o.wallet_satang, 'money_satang', o.money_satang),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('position', l.position, 'kind', l.kind, 'description_key', l.description_key, 'name_th', l.name_th, 'name_en', l.name_en,
                                          'unit_price_satang', l.unit_price_satang, 'discount_satang', l.discount_satang, 'net_satang', l.net_satang,
                                          'credit_units', l.credit_units, 'credit_value_satang', l.credit_value_satang, 'wallet_satang', l.wallet_satang, 'money_satang', l.money_satang)
                      order by l.position)
        from public.order_line l where l.club_id = v_club and l.order_id = p_order), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', p.method, 'amount_satang', p.amount_satang, 'confirmed_at', p.confirmed_at) order by p.confirmed_at, p.id)
        from public.payment p
       where p.club_id = v_club and p.status = 'succeeded'
         and ((v_kind = 'sale' and p.order_id = p_order) or (v_kind = 'wallet_credit' and p.id = p_payment))), '[]'::jsonb));

  -- The counter lock is the last lock taken. The upsert serialises parallel confirmations of one club and series.
  insert into public.receipt_counter as c (club_id, series, last_no, is_test) values (v_club, v_series, 1, v_test)
    on conflict (club_id, series) do update set last_no = c.last_no + 1
    returning c.last_no into v_no;
  v_number := v_prefix || '-' || v_year || '-' || repeat('0', greatest(6 - length(v_no::text), 0)) || v_no::text;

  insert into public.receipt (club_id, order_id, payment_id, kind, series, seq_no, number, vat_flag, customer_id, customer_name_snapshot, lines, total_satang, is_test)
    values (v_club, p_order, p_payment, v_kind, v_series, v_no, v_number, v_vat, o.customer_id, v_name, v_lines, o.total_satang, v_test)
    returning id into v_id;
  return v_id;
end $$;
alter function app.issue_receipt(uuid, uuid, text) owner to booq_owner;
revoke all on function app.issue_receipt(uuid, uuid, text) from public;
