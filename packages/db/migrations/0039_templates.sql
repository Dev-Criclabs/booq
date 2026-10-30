-- F01-T24 / migration 0039: the templates (Tennis, Blank, Padel and Pickleball to build) and app.apply_template.
-- Requirements: PLAT-05-AC7 to AC13, AC15, AC16; F01 design 9.1; decision D8. Values are copied from the spec; none are added.
--
-- A template is data (platform.template, platform.template_item). Starting a club from one COPIES the items
-- into the club's own tables, so a later template edit never changes an existing club (AC7). Items of the kinds
-- this feature owns are copied here (setting, opening_hours, label); products and prices belong to tables that
-- F04 and F06 create, so they are copied by handlers those features register (app.register_template_handler);
-- until one exists the kind is reported as pending. A TBD value is a template item whose value is JSON null:
-- it documents the gap and copies nothing, so the club's setting stays unset (AC9).
-- The 60 minute booking length is not a template value (AC15).

alter table public.club add column template_applied_at timestamptz;

-- Work for later features to do when a template is applied. A feature adds a row in its own migration.
-- The handler takes (club uuid, item key text, item value jsonb) and runs as the table owner in the club context.
create table app.template_handlers (
  kind text primary key check (kind <> ''),
  handler regprocedure not null
);
alter table app.template_handlers owner to booq_owner;
revoke all on app.template_handlers from public;

create function app.register_template_handler(p_kind text, p_fn regprocedure) returns void
language sql set search_path = pg_catalog
as $$ insert into app.template_handlers (kind, handler) values (p_kind, p_fn) $$;
alter function app.register_template_handler(text, regprocedure) owner to booq_owner;
revoke all on function app.register_template_handler(text, regprocedure) from public;

-- The definer function writes the club's rows as booq_owner, which row security also binds: it may add
-- settings and opening hours for the context club only.
create policy club_setting_owner_role_insert on public.club_setting for insert to booq_owner with check (club_id = app.club_id());
create policy opening_hours_owner_role_insert on public.opening_hours for insert to booq_owner with check (club_id = app.club_id());

-- Seeds ---------------------------------------------------------------------------------------------------
insert into platform.template (key, name, to_build) values
  ('tennis', 'Tennis', false), ('blank', 'Blank', false), ('padel', 'Padel', true), ('pickleball', 'Pickleball', true);

insert into platform.template_item (template_id, kind, key, value)
select t.id, i.kind, i.key, i.value::jsonb
  from platform.template t
  join (values
    -- Rules (PRD Booking and waitlist, D8, and the other values the PRD and decisions state)
    ('setting', 'hold_minutes', '15'),
    ('setting', 'waitlist_claim_minutes', '30'),
    ('setting', 'waitlist_no_offer_hours', '2'),
    ('setting', 'rest_cap_hours', '6'),
    ('setting', 'group_min_players', '4'),
    ('setting', 'group_max_players', '6'),
    ('setting', 'booking_window_days', '30'),
    ('setting', 'cancel_window_hours', '12'),
    ('setting', 'package_qr_minutes', '15'),
    ('setting', 'package_expiry_reminder_days', '[14, 3]'),
    ('setting', 'vat_enabled', 'false'),
    -- TBD in the PRD: empty, never invented (AC9)
    ('setting', 'max_future_court_hours', 'null'),
    ('setting', 'below_min_alert_minutes', 'null'),
    ('setting', 'wallet_expiry_months', 'null'),
    -- Opening hours 06:00 to 24:00, every day (weekday 1 Monday to 7 Sunday)
    ('opening_hours', '1', '{"open": "06:00", "close": "24:00"}'),
    ('opening_hours', '2', '{"open": "06:00", "close": "24:00"}'),
    ('opening_hours', '3', '{"open": "06:00", "close": "24:00"}'),
    ('opening_hours', '4', '{"open": "06:00", "close": "24:00"}'),
    ('opening_hours', '5', '{"open": "06:00", "close": "24:00"}'),
    ('opening_hours', '6', '{"open": "06:00", "close": "24:00"}'),
    ('opening_hours', '7', '{"open": "06:00", "close": "24:00"}'),
    -- The sport label (AC10): a code the screens turn into text from the language files
    ('label', 'resource', '"court"'),
    -- Final offer, PRD Pricing and packages, as integer satang (AC13)
    ('price', 'court_hour', '{"price_satang": 50000}'),
    ('product', 'bundle_10h', '{"type": "court_hours", "quantity": 10, "validity_months": 3, "price_satang": 450000}'),
    ('product', 'bundle_20h', '{"type": "court_hours", "quantity": 20, "validity_months": 5, "price_satang": 800000}'),
    ('product', 'solo_single_adult', '{"type": "solo_class", "audience": "adult", "quantity": 1, "validity_months": null, "price_satang": 80000}'),
    ('product', 'solo_pack8_adult', '{"type": "solo_class", "audience": "adult", "quantity": 8, "validity_months": 3, "price_satang": 560000}'),
    ('product', 'solo_single_student', '{"type": "solo_class", "audience": "student", "quantity": 1, "validity_months": null, "price_satang": 70000}'),
    ('product', 'solo_pack8_student', '{"type": "solo_class", "audience": "student", "quantity": 8, "validity_months": 3, "price_satang": 480000}'),
    ('product', 'group_single_adult', '{"type": "group_class", "audience": "adult", "quantity": 1, "validity_months": null, "price_satang": 60000}'),
    ('product', 'group_pack8_adult', '{"type": "group_class", "audience": "adult", "quantity": 8, "validity_months": 3, "price_satang": 400000}'),
    ('product', 'group_single_student', '{"type": "group_class", "audience": "student", "quantity": 1, "validity_months": null, "price_satang": 50000}'),
    ('product', 'group_pack8_student', '{"type": "group_class", "audience": "student", "quantity": 8, "validity_months": 3, "price_satang": 320000}')
  ) as i (kind, key, value) on true
 where t.key = 'tennis';

-- Applying -------------------------------------------------------------------------------------------------
-- The club comes from the context. Allowed for BOOQ staff who can see the club (P2 step 1) and for the club
-- owner (A0). Once per club, while it is Draft or Testing. All or nothing.
create function app.apply_template(p_template uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_t platform.template%rowtype;
  v_c public.club%rowtype;
  v_copied jsonb := '{}'::jsonb;
  v_pending text[] := array[]::text[];
  r record;
  v_handler regprocedure;
  n integer;
begin
  if v_club is null then
    raise exception 'template:no_club_context' using errcode = 'P0001';
  end if;
  select * into v_c from public.club c where c.id = v_club for update;
  if v_staff is not null then
    if not exists (select 1 from platform.platform_staff s where s.id = v_staff and s.active) or not platform.can_see_club(v_club) or v_c.id is null then
      raise exception 'template:not_found' using errcode = 'P0001';       -- unassigned and missing look the same
    end if;
  elsif v_c.id is null then
    raise exception 'template:not_found' using errcode = 'P0001';
  elsif not app.has_any_role('owner') then
    raise exception 'template:not_allowed' using errcode = 'P0001';
  end if;
  select * into v_t from platform.template t where t.id = p_template;
  if not found then
    raise exception 'template:not_found' using errcode = 'P0001';
  end if;
  if v_t.to_build then
    raise exception 'template:to_build' using errcode = 'P0001';
  end if;
  if v_c.template_applied_at is not null then
    raise exception 'template:already_applied' using errcode = 'P0001';
  end if;
  if v_c.status not in ('draft', 'testing') then
    raise exception 'template:not_a_start' using errcode = 'P0001';
  end if;

  for r in select i.kind, i.key, i.value from platform.template_item i where i.template_id = p_template order by i.kind, i.key loop
    if r.kind = 'setting' then
      continue when r.value = 'null'::jsonb;                              -- a TBD stays unset (AC9)
      insert into public.club_setting (club_id, key, value) values (v_club, r.key, r.value);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    elsif r.kind = 'opening_hours' then
      insert into public.opening_hours (club_id, weekday, open, close)
        values (v_club, r.key::smallint, (r.value ->> 'open')::time, (r.value ->> 'close')::time);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    elsif r.kind = 'label' then
      insert into public.club_setting (club_id, key, value) values (v_club, r.key || '_label', r.value);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    else
      select h.handler into v_handler from app.template_handlers h where h.kind = r.kind;
      if v_handler is null then
        if not (r.kind = any (v_pending)) then v_pending := v_pending || r.kind; end if;
      else
        execute format('select %s($1, $2, $3)', v_handler::regproc::text) using v_club, r.key, r.value;
        v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
      end if;
    end if;
  end loop;

  update public.club set template_id = p_template, template_applied_at = app.now() where id = v_club;
  perform audit.note('template.applied', 'club', v_club,
                     jsonb_build_object('template', v_t.key, 'copied', v_copied, 'pending', to_jsonb(v_pending)), null);
  return jsonb_build_object('template', v_t.key, 'copied', v_copied, 'pending', to_jsonb(v_pending));
end $$;
alter function app.apply_template(uuid) owner to booq_owner;
revoke all on function app.apply_template(uuid) from public;
grant execute on function app.apply_template(uuid) to booq_platform, booq_app;
