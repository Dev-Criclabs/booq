-- F11 / migration 1109: the receipt ids beside the receipt numbers in the customer orders read, so A6 can link each PDF (orchestrator note from
-- lane 2). Redefines public.customer_orders of 1103 with one more column; numbered above it (D159). receipt_ids is in the same order as receipts.
drop function public.customer_orders(uuid);
create function public.customer_orders(p_user uuid)
  returns table (order_id uuid, status text, source text, kind text, total_satang integer, money_satang integer, credit_value_satang integer,
                 wallet_satang integer, created_at timestamptz, receipts text[], receipt_ids uuid[])
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  return query
    select o.id, o.status, o.source, o.kind, o.total_satang, o.money_satang, o.credit_value_satang, o.wallet_satang, o.created_at,
           coalesce((select array_agg(rc.number order by rc.issued_at, rc.id) from public.receipt rc where rc.club_id = o.club_id and rc.order_id = o.id), '{}'::text[]),
           coalesce((select array_agg(rc.id order by rc.issued_at, rc.id) from public.receipt rc where rc.club_id = o.club_id and rc.order_id = o.id), '{}'::uuid[])
      from public.orders o
     where o.club_id = app.club_id() and o.customer_id = p_user and o.priced_at is not null
     order by o.created_at desc, o.id;
end $$;
alter function public.customer_orders(uuid) owner to booq_owner;
revoke all on function public.customer_orders(uuid) from public;
grant execute on function public.customer_orders(uuid) to booq_app;
