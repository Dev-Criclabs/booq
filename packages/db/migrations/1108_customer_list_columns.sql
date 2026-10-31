-- F11 / migration 1108: the A5 Customers columns and filters of the H-A05 board (ADMIN-06; orchestrator note from lane 2). Redefines
-- public.customer_list (1102), so it is numbered above it (D159); the old five argument function is dropped.
-- New columns: group (the price group the person's date of birth falls in, null when no date of birth or not exactly one group; the age rule
-- of F04's groupFor, so the board's Adult and Student are the club's own groups), package (the active package that ends soonest: name, credits
-- left, ends at), wallet_satang, last_visit_at (the latest confirmed booking whose hour has started).
-- New filters: p_group (a price group id), and p_status: 'active_package' (an active package with credits left), 'expiring_soon' (an active
-- package ending within the largest value of the club setting package_expiry_reminder_days; the setting is read, none is assumed, and an
-- unset setting refuses with setting_unset), 'no_visit' (no confirmed booking began in the last 30 days, the board's own wording).
drop function public.customer_list(text, text, text, uuid, integer);
create function public.customer_list(p_q text default null, p_tag text default null, p_after_name text default null, p_after_id uuid default null,
                                     p_limit integer default 50, p_status text default null, p_group uuid default null)
  returns table (id uuid, display_name text, full_name text, phone text, tags text[], claim_state text, signed_in boolean, last_booking_at timestamptz,
                 booking_count integer, created_at timestamptz, group_id uuid, group_name_th text, group_name_en text, package_name_th text,
                 package_name_en text, package_credits_left integer, package_expires_at timestamptz, wallet_satang bigint, last_visit_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_digits text;
  v_like text;
  v_today date := (app.now() at time zone 'Asia/Bangkok')::date;
  v_soon integer;
begin
  if v_club is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'customers: invalid limit' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('active_package', 'expiring_soon', 'no_visit') then
    raise exception 'customers: invalid status' using errcode = 'P0001';
  end if;
  if p_status = 'expiring_soon' then
    select max(x::integer) into v_soon
      from public.club_setting s, jsonb_array_elements_text(s.value) x
     where s.club_id = v_club and s.key = 'package_expiry_reminder_days' and jsonb_typeof(s.value) = 'array';
    if v_soon is null then
      perform app.refuse('setting_unset');
    end if;
  end if;
  v_digits := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    with base as (
      select u.id, u.display_name, u.full_name, u.phone, u.claim_state, (u.line_user_id is not null) as signed_in, u.created_at, u.date_of_birth,
             coalesce(u.full_name, u.display_name, '') as sort_name
        from public.app_user u
       where u.club_id = v_club and u.anonymised_at is null and u.claim_state is distinct from 'merged'
         and (v_q is null
              or u.display_name ilike v_like or u.full_name ilike v_like
              or (char_length(v_digits) >= 3 and (u.phone_normalized like '%' || v_digits || '%'))
              or exists (select 1 from public.customer_tag t where t.club_id = u.club_id and t.user_id = u.id and lower(t.tag) = lower(v_q)))
         and (nullif(btrim(coalesce(p_tag, '')), '') is null
              or exists (select 1 from public.customer_tag t where t.club_id = u.club_id and t.user_id = u.id and lower(t.tag) = lower(btrim(p_tag))))
         and (p_after_name is null or (coalesce(u.full_name, u.display_name, ''), u.id) > (p_after_name, p_after_id))
    ), enriched as (
      select b.*,
             (select g.id from public.price_group g where b.date_of_birth is not null and g.club_id = v_club
                 and ((not (g.rule ? 'min_age')) or date_part('year', age(v_today, b.date_of_birth)) >= (g.rule ->> 'min_age')::int)
                 and ((not (g.rule ? 'max_age')) or date_part('year', age(v_today, b.date_of_birth)) <= (g.rule ->> 'max_age')::int)
                 and (select count(*) from public.price_group g2 where g2.club_id = v_club
                        and ((not (g2.rule ? 'min_age')) or date_part('year', age(v_today, b.date_of_birth)) >= (g2.rule ->> 'min_age')::int)
                        and ((not (g2.rule ? 'max_age')) or date_part('year', age(v_today, b.date_of_birth)) <= (g2.rule ->> 'max_age')::int)) = 1) as gid,
             (select p.id from public.customer_package p join public.package_status s on s.package_id = p.id
               where p.club_id = v_club and p.customer_id = b.id and s.status = 'active' and s.credits_left > 0
               order by p.expires_at, p.id limit 1) as pkg
        from base b
    )
    select e.id, e.display_name, e.full_name, e.phone,
           coalesce((select array_agg(t.tag order by lower(t.tag)) from public.customer_tag t where t.club_id = v_club and t.user_id = e.id), '{}'::text[]),
           e.claim_state, e.signed_in,
           (select max(k.start_at) from public.booking k where k.club_id = v_club and k.customer_id = e.id and k.status in ('confirmed', 'no_show', 'late_cancelled')),
           (select count(*)::integer from public.booking k where k.club_id = v_club and k.customer_id = e.id and k.status in ('confirmed', 'no_show', 'late_cancelled')),
           e.created_at,
           e.gid, gg.name_th, gg.name_en, pp.name_th, pp.name_en, ps.credits_left, cp.expires_at,
           coalesce((select w.balance_satang from public.wallet_balance w where w.customer_id = e.id), 0)::bigint,
           (select max(k.start_at) from public.booking k where k.club_id = v_club and k.customer_id = e.id and k.status = 'confirmed' and k.start_at <= app.now())
      from enriched e
      left join public.price_group gg on gg.club_id = v_club and gg.id = e.gid
      left join public.customer_package cp on cp.club_id = v_club and cp.id = e.pkg
      left join public.package_product pp on pp.club_id = v_club and pp.id = cp.product_id
      left join public.package_status ps on ps.package_id = e.pkg
     where (p_group is null or e.gid = p_group)
       and (p_status is null
            or (p_status = 'active_package' and e.pkg is not null)
            or (p_status = 'expiring_soon' and e.pkg is not null and cp.expires_at <= app.now() + make_interval(days => v_soon))
            or (p_status = 'no_visit' and not exists (select 1 from public.booking k where k.club_id = v_club and k.customer_id = e.id and k.status = 'confirmed'
                                                       and k.start_at <= app.now() and k.start_at > app.now() - interval '30 days')))
     order by e.sort_name, e.id
     limit p_limit;
end $$;
alter function public.customer_list(text, text, text, uuid, integer, text, uuid) owner to booq_owner;
revoke all on function public.customer_list(text, text, text, uuid, integer, text, uuid) from public;
grant execute on function public.customer_list(text, text, text, uuid, integer, text, uuid) to booq_app;
