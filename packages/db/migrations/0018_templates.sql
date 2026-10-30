-- F01-T24 / migration 0018: the templates and platform.apply_template. F01 design 9.1.
-- Requirements: PLAT-05-AC7 to AC13, AC15 (AC14 is a question). Decision D8.
--
-- A template is data: platform.template and platform.template_item (migration 0004). Starting a club
-- from one COPIES its items into the club's own tables, once, so a later template edit changes no
-- existing club (AC7). The Tennis template carries only values the spec gives (AC13, AC15); every TBD
-- stays an empty setting (AC9): there is simply no row. The Blank template copies nothing (AC8).
-- Padel and Pickleball exist, marked to_build, and cannot be chosen (AC11).
--
-- Item kinds this file understands: 'setting' (a club_setting row), 'opening_hours' (key = ISO weekday
-- 1 to 7, value {open, close}), 'sport' (key = sport code, value {unit}: court, table or lane; the words
-- come from the locale files, AC10). Any other kind goes to a handler a later feature registers in
-- app.template_handlers (F04: price groups, court prices, coach tiers, add-ons; F06: packages). An item
-- with no handler stops the copy and rolls it back: nothing is dropped silently.

create table app.template_handlers (
  kind text primary key check (kind <> ''),
  handler regprocedure not null,                 -- (club uuid, key text, value jsonb) returns void
  created_at timestamptz not null default app.now()
);
alter table app.template_handlers owner to booq_owner;
revoke all on app.template_handlers from public;

-- The definer works as booq_owner, which row security also binds: it may write the setup rows of the
-- club in the context and nothing else.
create policy club_setting_definer_write on public.club_setting for insert to booq_owner with check (club_id = app.club_id());
create policy opening_hours_definer_write on public.opening_hours for insert to booq_owner with check (club_id = app.club_id());

insert into platform.template (key, name, to_build) values
  ('tennis', 'Tennis', false),
  ('blank', 'Blank', false),
  ('padel', 'Padel', true),
  ('pickleball', 'Pickleball', true)
on conflict (key) do nothing;

-- Tennis (Hunter's defaults): only what PRD and the hand-off state.
insert into platform.template_item (template_id, kind, key, value)
select t.id, i.kind, i.key, i.value
  from platform.template t
  cross join (values
    ('setting', 'hold_minutes', '15'::jsonb),
    ('setting', 'waitlist_claim_minutes', '30'::jsonb),
    ('setting', 'waitlist_no_offer_hours', '2'::jsonb),
    ('setting', 'rest_cap_hours', '6'::jsonb),
    ('setting', 'group_min_players', '4'::jsonb),
    ('setting', 'group_max_players', '6'::jsonb),
    ('setting', 'package_expiry_reminder_days', '[14, 3]'::jsonb),
    ('setting', 'package_qr_minutes', '15'::jsonb),
    ('opening_hours', '1', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('opening_hours', '2', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('opening_hours', '3', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('opening_hours', '4', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('opening_hours', '5', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('opening_hours', '6', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('opening_hours', '7', '{"open": "06:00", "close": "24:00"}'::jsonb),
    ('sport', 'tennis', '{"unit": "court"}'::jsonb)
  ) as i(kind, key, value)
 where t.key = 'tennis'
on conflict do nothing;

-- Start the club in the context from a template. BOOQ staff only (P2 step 1; the owner's A0 choice is F11's).
create function platform.apply_template(p_template uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  c public.club%rowtype;
  t platform.template%rowtype;
  i record;
  v_counts jsonb := '{}';
  v_n integer;
  v_handler regprocedure;
begin
  if v_club is null then
    raise exception 'template:no_club_context' using errcode = 'P0001';
  end if;
  if platform.staff_role() is null or not platform.can_see_club(v_club) then
    raise exception 'template:not_found' using errcode = 'P0001';
  end if;
  select * into c from public.club where id = v_club for update;
  select * into t from platform.template where id = p_template;
  if not found then
    raise exception 'template:not_found' using errcode = 'P0001';
  end if;
  if t.to_build then
    raise exception 'template:to_build' using errcode = 'P0001';              -- AC11
  end if;
  if c.status <> 'draft' or c.template_id is not null then
    raise exception 'template:already_started' using errcode = 'P0001';      -- a club is started from a template once, in Draft
  end if;

  for i in select * from platform.template_item where template_id = t.id order by kind, key loop
    if i.kind = 'setting' then
      insert into public.club_setting (club_id, key, value) values (v_club, i.key, i.value);
    elsif i.kind = 'opening_hours' then
      insert into public.opening_hours (club_id, weekday, open, close)
        values (v_club, i.key::smallint, (i.value ->> 'open')::time, (i.value ->> 'close')::time);
    elsif i.kind = 'sport' then
      null;                                                                    -- the label is read from the template's code at display time; a court gets its sport when it is created
    else
      select h.handler into v_handler from app.template_handlers h where h.kind = i.kind;
      if v_handler is null then
        raise exception 'template:no_handler:%', i.kind using errcode = 'P0001';
      end if;
      execute format('select %s($1, $2, $3)', v_handler::regproc::text) using v_club, i.key, i.value;
    end if;
    v_counts := jsonb_set(v_counts, array[i.kind], to_jsonb(coalesce((v_counts ->> i.kind)::int, 0) + 1));
  end loop;

  update public.club set template_id = t.id where id = v_club;
  perform audit.note('template.applied', 'club', v_club, jsonb_build_object('template', t.key, 'items', v_counts));
  perform platform.write_audit('club.template_applied', v_club, 'club', v_club::text, jsonb_build_object('template', t.key, 'items', v_counts), null, null);
  return jsonb_build_object('template', t.key, 'items', v_counts);
end $$;
alter function platform.apply_template(uuid) owner to booq_owner;
revoke all on function platform.apply_template(uuid) from public;
grant execute on function platform.apply_template(uuid) to booq_platform;
