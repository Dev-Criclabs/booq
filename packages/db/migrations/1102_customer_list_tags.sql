-- F11-T04 / migration 1102: the customer list, tags and the walk in quick add (ADMIN-06, ADMIN-04; F11 design 6.2; D168).
--   public.customer_tag            a tag a club typed on a customer (free text, 1 to 40 characters, no default list; A-3). Class D, audited.
--                                  Written only by app.customer_tag_set. Test rows follow the person (D100).
--   public.customer_list(q, tag, after_name, after_id, limit)  owner and front desk. Search by name, phone digits or tag; keyset paged by
--                                  (name, id). Anonymised people and merged imports are not listed. The phone is returned because both
--                                  roles may see it (customer.contact.read); no date of birth.
--   app.customer_tag_set(user, tag, on)  owner and front desk; adding twice or removing a missing tag changes nothing.
--   app.staff_add_customer(name, phone, phone_normalized)  owner and front desk. The same kind of person an import makes: no LINE id,
--                                  claim_state 'unclaimed', Player role. Name and phone only; no consent is implied and the player
--                                  confirms at first sign in (D168). A phone already held by an unclaimed person is refused (phone_in_use).
--   app.audit_customer_export(rows)  the audit entry of a customer CSV (ADMIN-06): who exported and how many rows, never a row.

create table public.customer_tag (
  club_id uuid not null,
  user_id uuid not null,
  tag text not null,
  created_by uuid not null,
  created_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, user_id, tag),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  foreign key (club_id, created_by) references public.app_user (club_id, id),
  constraint customer_tag_text check (tag = btrim(tag) and char_length(tag) between 1 and 40)
);
create index customer_tag_by_tag on public.customer_tag (club_id, lower(tag));
alter table public.customer_tag owner to booq_owner;
alter table public.customer_tag enable row level security;
alter table public.customer_tag force row level security;
revoke all on public.customer_tag from public;
create policy customer_tag_tenant on public.customer_tag as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy customer_tag_definer on public.customer_tag for all to booq_owner using (true) with check (true);
create policy customer_tag_staff_read on public.customer_tag for select to booq_app using (app.has_any_role('owner', 'front_desk'));
grant select on public.customer_tag to booq_app;
create trigger is_test_copy before insert on public.customer_tag for each row execute function app.copy_user_is_test();
select app.register_test_table('public.customer_tag', 840, false);
select audit.register('public.customer_tag', array['user_id', 'tag']);

create function public.customer_list(p_q text default null, p_tag text default null, p_after_name text default null, p_after_id uuid default null,
                                     p_limit integer default 50)
  returns table (id uuid, display_name text, full_name text, phone text, tags text[], claim_state text, signed_in boolean, last_booking_at timestamptz,
                 booking_count integer, created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_digits text;
  v_like text;
begin
  if v_club is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'customers: invalid limit' using errcode = 'P0001';
  end if;
  v_digits := regexp_replace(coalesce(v_q, ''), '[^0-9]', '', 'g');
  v_like := '%' || replace(replace(replace(coalesce(v_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select u.id, u.display_name, u.full_name, u.phone,
           coalesce((select array_agg(t.tag order by lower(t.tag)) from public.customer_tag t where t.club_id = u.club_id and t.user_id = u.id), '{}'::text[]),
           u.claim_state, (u.line_user_id is not null),
           (select max(b.start_at) from public.booking b where b.club_id = u.club_id and b.customer_id = u.id and b.status in ('confirmed', 'no_show', 'late_cancelled')),
           (select count(*)::integer from public.booking b where b.club_id = u.club_id and b.customer_id = u.id and b.status in ('confirmed', 'no_show', 'late_cancelled')),
           u.created_at
      from public.app_user u
     where u.club_id = v_club and u.anonymised_at is null and u.claim_state is distinct from 'merged'
       and (v_q is null
            or u.display_name ilike v_like or u.full_name ilike v_like
            or (char_length(v_digits) >= 3 and (u.phone_normalized like '%' || v_digits || '%'))
            or exists (select 1 from public.customer_tag t where t.club_id = u.club_id and t.user_id = u.id and lower(t.tag) = lower(v_q)))
       and (nullif(btrim(coalesce(p_tag, '')), '') is null
            or exists (select 1 from public.customer_tag t where t.club_id = u.club_id and t.user_id = u.id and lower(t.tag) = lower(btrim(p_tag))))
       and (p_after_name is null or (coalesce(u.full_name, u.display_name, ''), u.id) > (p_after_name, p_after_id))
     order by coalesce(u.full_name, u.display_name, ''), u.id
     limit p_limit;
end $$;
alter function public.customer_list(text, text, text, uuid, integer) owner to booq_owner;
revoke all on function public.customer_list(text, text, text, uuid, integer) from public;
grant execute on function public.customer_list(text, text, text, uuid, integer) to booq_app;

create function app.customer_tag_set(p_user uuid, p_tag text, p_on boolean) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_tag text := btrim(coalesce(p_tag, ''));
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  if char_length(v_tag) not between 1 and 40 or p_on is null then
    raise exception 'customers: invalid tag' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_user and u.anonymised_at is null) then
    raise exception 'customers: unknown customer' using errcode = 'P0001';
  end if;
  if p_on then
    insert into public.customer_tag (club_id, user_id, tag, created_by) values (v_club, p_user, v_tag, app.user_id()) on conflict do nothing;
  else
    delete from public.customer_tag where club_id = v_club and user_id = p_user and lower(tag) = lower(v_tag);
  end if;
end $$;
alter function app.customer_tag_set(uuid, text, boolean) owner to booq_owner;
revoke all on function app.customer_tag_set(uuid, text, boolean) from public;
grant execute on function app.customer_tag_set(uuid, text, boolean) to booq_app;

create function app.staff_add_customer(p_name text, p_phone text, p_phone_normalized text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_id uuid;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_phone, '')) = '' or p_phone_normalized is null then
    raise exception 'customers: invalid customer' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.app_user u where u.club_id = v_club and u.claim_state = 'unclaimed' and u.phone_normalized = p_phone_normalized) then
    perform app.refuse('phone_in_use');
  end if;
  begin
    insert into public.app_user (club_id, full_name, phone, phone_normalized, claim_state)
    values (v_club, btrim(p_name), p_phone, p_phone_normalized, 'unclaimed') returning id into v_id;
  exception when check_violation then
    raise exception 'customers: invalid customer (%)' , sqlerrm using errcode = 'P0001';
  end;
  insert into public.app_user_role (club_id, user_id, role) values (v_club, v_id, 'player') on conflict do nothing;
  return v_id;
end $$;
alter function app.staff_add_customer(text, text, text) owner to booq_owner;
revoke all on function app.staff_add_customer(text, text, text) from public;
grant execute on function app.staff_add_customer(text, text, text) to booq_app;

create function app.audit_customer_export(p_rows integer) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') or p_rows is null or p_rows < 0 then
    raise exception 'customers: not allowed' using errcode = '42501';
  end if;
  perform audit.note('customers.exported', 'customer_export', gen_random_uuid(), jsonb_build_object('rows', p_rows));
end $$;
alter function app.audit_customer_export(integer) owner to booq_owner;
revoke all on function app.audit_customer_export(integer) from public;
grant execute on function app.audit_customer_export(integer) to booq_app;
