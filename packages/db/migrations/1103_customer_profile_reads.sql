-- F11-T06 / migration 1103: what A6 Customer profile reads (ADMIN-07; F11 design 6.3). Owner and front desk only (customer.contact.read); the
-- Accountant has no profile. Each function takes the club from the context and returns nothing of another club.
--   public.customer_profile(user)  details: names, phone, language, level, the date of birth (shown to both roles, D55; its change history
--                                  is the owner's own route), claim state, whether the person has signed in, tags, created at.
--   public.customer_bookings(user) the person's bookings, newest first: type, court, coach, hour, status and the latest cancel outcome.
--   public.customer_orders(user)   the person's orders, newest first: status, source, the money, credit and wallet parts, receipt numbers.
-- A person who was anonymised or merged is not found.
create function public.customer_profile(p_user uuid)
  returns table (id uuid, display_name text, full_name text, phone text, language text, level text, date_of_birth date, claim_state text,
                 signed_in boolean, active boolean, tags text[], created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  return query
    select u.id, u.display_name, u.full_name, u.phone, u.language, u.level, u.date_of_birth, u.claim_state, (u.line_user_id is not null), u.active,
           coalesce((select array_agg(t.tag order by lower(t.tag)) from public.customer_tag t where t.club_id = u.club_id and t.user_id = u.id), '{}'::text[]),
           u.created_at
      from public.app_user u
     where u.club_id = app.club_id() and u.id = p_user and u.anonymised_at is null and u.claim_state is distinct from 'merged';
end $$;
alter function public.customer_profile(uuid) owner to booq_owner;
revoke all on function public.customer_profile(uuid) from public;
grant execute on function public.customer_profile(uuid) to booq_app;

create function public.customer_bookings(p_user uuid)
  returns table (booking_id uuid, order_id uuid, type text, resource_name text, coach_name text, class_name_th text, class_name_en text, start_at timestamptz,
                 end_at timestamptz, status text, source text, cancel_kind text, cancel_outcome text)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  return query
    select b.id, b.order_id, b.type, r.name, co.display_name, cs.name_th, cs.name_en, b.start_at, b.end_at, b.status, b.source, c.kind, c.outcome
      from public.booking b
      left join public.resource r on r.club_id = b.club_id and r.id = b.resource_id
      left join public.app_user co on co.club_id = b.club_id and co.id = b.coach_id
      left join public.class_session cs on cs.club_id = b.club_id and cs.id = b.class_session_id
      left join lateral (select bc.kind, bc.outcome from public.booking_cancel bc where bc.club_id = b.club_id and bc.booking_id = b.id
                          order by bc.version desc, bc.created_at desc limit 1) c on true
     where b.club_id = app.club_id() and b.customer_id = p_user
     order by b.start_at desc, b.id;
end $$;
alter function public.customer_bookings(uuid) owner to booq_owner;
revoke all on function public.customer_bookings(uuid) from public;
grant execute on function public.customer_bookings(uuid) to booq_app;

create function public.customer_orders(p_user uuid)
  returns table (order_id uuid, status text, source text, kind text, total_satang integer, money_satang integer, credit_value_satang integer,
                 wallet_satang integer, created_at timestamptz, receipts text[])
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  return query
    select o.id, o.status, o.source, o.kind, o.total_satang, o.money_satang, o.credit_value_satang, o.wallet_satang, o.created_at,
           coalesce((select array_agg(rc.number order by rc.issued_at) from public.receipt rc where rc.club_id = o.club_id and rc.order_id = o.id), '{}'::text[])
      from public.orders o
     where o.club_id = app.club_id() and o.customer_id = p_user and o.priced_at is not null
     order by o.created_at desc, o.id;
end $$;
alter function public.customer_orders(uuid) owner to booq_owner;
revoke all on function public.customer_orders(uuid) from public;
grant execute on function public.customer_orders(uuid) to booq_app;
