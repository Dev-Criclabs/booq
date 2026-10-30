-- F01-T27b / migration 0046: the Go live checks have producers (PLAT-01-AC3 to AC5, AC12; PLAT-07-AC4; PLAT-05-AC8, AC16;
-- decisions D32, D61, D106, D108; review T22-T23, "every key needs a producer").
--
--   * app.launch_producers names, for every check key, how its result is made: `derived` (a function of the
--     club's own data, computed when asked, never typed in) or `recorded` (a result written by one audited function,
--     platform.record_launch_check, or by the function that owns the fact, such as the owner invite redemption).
--     A feature that owns the data of a recorded check switches it to derived with app.register_launch_producer.
--   * app.launch_result(club, key) is the one reader; app.status_blockers (Testing to Live) and platform.club_progress (P3)
--     use it. A key with no producer answers `no_producer` and blocks, so a key nothing can write cannot be added silently.
--     The order inside the Go live transaction is unchanged: blockers (the checks), then the purge, then Live (0032).
--   * app.setting_keys says which settings a template must have set (`required`) and which exist only for a slip club.
--   * platform.launch_check is no longer writable by a role; platform.config is changed only through
--     platform.set_config_value, which writes P6. This closes review T22-T23 (b): an admin can no longer shorten the list unseen.

-- Required settings (PLAT-05-AC8, AC16; design 10: "unset allowed" is the opposite of required).
alter table app.setting_keys add column required boolean not null default true, add column slip_only boolean not null default false;
update app.setting_keys set required = false where setting_key in ('max_future_court_hours', 'below_min_alert_minutes', 'wallet_expiry_months');
update app.setting_keys set slip_only = true where setting_key = 'auto_slip_check';

create table app.launch_producers (
  check_key text primary key check (check_key <> ''),
  kind text not null check (kind in ('derived', 'recorded')),
  derive_fn regprocedure,                       -- derived: fn(club uuid) returns boolean
  guard_fn regprocedure,                        -- recorded: a pass only counts while fn(club uuid) is true (the Beam key swap)
  only_payment_option text,                     -- the check applies to clubs with this payment option; others pass
  task text not null check (task <> ''),        -- who makes the result; 'awaiting:<feature>' until that feature registers it
  constraint launch_producer_shape check ((kind = 'derived') = (derive_fn is not null))
);
alter table app.launch_producers owner to booq_owner;
revoke all on app.launch_producers from public;
grant select on app.launch_producers to booq_platform;

create function app.register_launch_producer(p_key text, p_fn regprocedure, p_task text) returns void
language sql set search_path = pg_catalog
as $$
  insert into app.launch_producers (check_key, kind, derive_fn, task) values (p_key, 'derived', p_fn, p_task)
  on conflict (check_key) do update set kind = 'derived', derive_fn = excluded.derive_fn, guard_fn = null, task = excluded.task
$$;
alter function app.register_launch_producer(text, regprocedure, text) owner to booq_owner;
revoke all on function app.register_launch_producer(text, regprocedure, text) from public;

-- Derived checks. Each takes the club and answers true or false; nothing here reads another club.
create function app.launch_line_test(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select app.setup_line(p_club) $$;

create function app.launch_receipt_prefix(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select exists (select 1 from public.club c where c.id = p_club and btrim(coalesce(c.receipt_prefix, '')) <> '') $$;

-- Both platform values must be set to positive numbers. The values are Security's (F03 design 4.8); none is shipped.
create function app.launch_pay_tap_limit(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select (select count(*) from platform.config c
           where c.key in ('pay_tap_limit_count', 'pay_tap_limit_window_seconds')
             and jsonb_typeof(c.value) = 'number' and (c.value #>> '{}')::numeric > 0) = 2
$$;

create function app.launch_template_settings(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select not exists (
    select 1 from app.setting_keys k
     where k.required
       and (not k.slip_only or exists (select 1 from public.club c where c.id = p_club and c.payment_option = 'slip'))
       and not exists (select 1 from public.club_setting s where s.club_id = p_club and s.key = k.setting_key and s.value <> 'null'::jsonb))
$$;

create function app.launch_no_open_failure(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select not exists (select 1 from platform.launch_check c where c.club_id = p_club and c.result = 'fail') $$;

-- The live Beam key set is in place (D32, A-23): the live merchant and both live secrets. Whether the smoke test passed is
-- the recorded part. The Beam webhook token waits for F05, so it is not asked for here.
create function app.launch_beam_live_keys(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (select 1 from public.payment_connection p where p.club_id = p_club and btrim(coalesce(p.merchant_id_live, '')) <> '')
     and (select count(*) from public.club_secret s where s.club_id = p_club and s.kind in ('beam_api_key_live', 'beam_hmac_key_live')) = 2
$$;

do $$
declare f text;
begin
  foreach f in array array['app.launch_line_test(uuid)', 'app.launch_receipt_prefix(uuid)', 'app.launch_pay_tap_limit(uuid)',
                           'app.launch_template_settings(uuid)', 'app.launch_no_open_failure(uuid)', 'app.launch_beam_live_keys(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

insert into app.launch_producers (check_key, kind, derive_fn, guard_fn, only_payment_option, task) values
  ('line_test', 'derived', 'app.launch_line_test(uuid)'::regprocedure, null, null, 'F01-T24 connection test'),
  ('pay_tap_limit_set', 'derived', 'app.launch_pay_tap_limit(uuid)'::regprocedure, null, null, 'F03 design 4.8, platform config'),
  ('receipt_prefix_set', 'derived', 'app.launch_receipt_prefix(uuid)'::regprocedure, null, null, 'F01-T19 P2 step 1, D106'),
  ('template_required_settings', 'derived', 'app.launch_template_settings(uuid)'::regprocedure, null, null, 'F01-T08 settings registry'),
  ('no_open_launch_failure', 'derived', 'app.launch_no_open_failure(uuid)'::regprocedure, null, null, 'F01-T27b'),
  ('beam_key_swap', 'recorded', null, 'app.launch_beam_live_keys(uuid)'::regprocedure, 'beam', 'F05-T11 smoke test, platform.record_launch_check'),
  ('owner_signed_in', 'recorded', null, null, null, 'F01-T23 app.redeem_invite'),
  ('owner_verified', 'recorded', null, null, null, 'F01-T23 app.redeem_invite and confirm_owner_verified'),
  ('product_priced', 'recorded', null, null, null, 'awaiting:F04 (derive from the price tables with app.register_launch_producer)'),
  ('test_booking_completed', 'recorded', null, null, null, 'awaiting:F03 (derive from a confirmed test booking with app.register_launch_producer)');

-- The one reader. pass, fail, pending, or no_producer.
create function app.launch_result(p_club uuid, p_key text) returns text
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  p app.launch_producers%rowtype;
  v_row text;
  v_ok boolean;
begin
  select * into p from app.launch_producers where check_key = p_key;
  if not found then return 'no_producer'; end if;
  if p.only_payment_option is not null
     and exists (select 1 from public.club c where c.id = p_club and c.payment_option is not null and c.payment_option <> p.only_payment_option) then
    return 'pass';   -- does not apply to this club (a slip club has no Beam key swap); a club with no option chosen yet still owes it
  end if;
  if p.kind = 'derived' then
    execute format('select %s($1)', p.derive_fn::oid::regproc) into v_ok using p_club;
    return case when v_ok then 'pass' else 'pending' end;
  end if;
  select c.result into v_row from platform.launch_check c where c.club_id = p_club and c.check_key = p_key;
  if v_row is null then return 'pending'; end if;
  if v_row = 'pass' and p.guard_fn is not null then
    execute format('select %s($1)', p.guard_fn::oid::regproc) into v_ok using p_club;
    if not v_ok then return 'fail'; end if;
  end if;
  return v_row;
end $$;
alter function app.launch_result(uuid, text) owner to booq_owner;
revoke all on function app.launch_result(uuid, text) from public;
grant execute on function app.launch_result(uuid, text) to booq_platform;

create or replace function app.status_blockers(p_club uuid, p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_cfg jsonb;
begin
  if p_from = 'draft' and p_to = 'testing' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('item', s.step_key, 'owed_by', s.owed_by) order by s.position, s.step_key)
        from app.setup_steps s where not app.setup_step_done(s.check_fn, p_club)
    ), '[]'::jsonb);
  end if;
  if p_from = 'testing' and p_to = 'live' then
    select c.value into v_cfg from platform.config c where c.key = 'required_launch_checks';
    if v_cfg is null or jsonb_typeof(v_cfg) <> 'array' or jsonb_array_length(v_cfg) = 0 then
      return jsonb_build_array(jsonb_build_object('item', 'required_launch_checks_not_configured', 'owed_by', 'booq', 'result', 'missing'));
    end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object('item', e.r ->> 'key', 'owed_by', e.r ->> 'owed_by', 'result', app.launch_result(p_club, e.r ->> 'key')) order by e.ord)
        from jsonb_array_elements(v_cfg) with ordinality as e(r, ord)
       where app.launch_result(p_club, e.r ->> 'key') <> 'pass'
    ), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;

create or replace function platform.club_progress(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  v_cfg jsonb;
begin
  if not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    return null;
  end if;
  select c.value into v_cfg from platform.config c where c.key = 'required_launch_checks';
  return jsonb_build_object(
    'setup', coalesce((
      select jsonb_agg(jsonb_build_object('item', s.step_key, 'done', app.setup_step_done(s.check_fn, p_club), 'owed_by', s.owed_by) order by s.position, s.step_key)
        from app.setup_steps s
    ), '[]'::jsonb),
    'launch', case when v_cfg is null or jsonb_typeof(v_cfg) <> 'array' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('item', e.r ->> 'key', 'result', app.launch_result(p_club, e.r ->> 'key'), 'owed_by', e.r ->> 'owed_by') order by e.ord)
        from jsonb_array_elements(v_cfg) with ordinality as e(r, ord)
    ), '[]'::jsonb) end
  );
end $$;

-- Recorded results: one function, admin only (a specialist cannot mark a check as passed), a Testing club, a recorded key.
create function platform.record_launch_check(p_club uuid, p_key text, p_result text) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_status text;
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) then
    raise exception 'launch_check:not_found' using errcode = 'P0001';
  end if;
  select c.status into v_status from public.club c where c.id = p_club;
  if v_status is null then
    raise exception 'launch_check:not_found' using errcode = 'P0001';
  end if;
  if not platform.is_admin() then
    raise exception 'launch_check:forbidden' using errcode = 'P0001';
  end if;
  if v_status <> 'testing' then
    raise exception 'launch_check:not_testing' using errcode = 'P0001';
  end if;
  if not exists (select 1 from app.launch_producers where check_key = p_key and kind = 'recorded') then
    raise exception 'launch_check:not_recorded' using errcode = 'P0001';
  end if;
  if p_result is null or p_result not in ('pass', 'fail', 'pending') then
    raise exception 'launch_check:invalid_result' using errcode = 'P0001';
  end if;
  insert into platform.launch_check (club_id, check_key, result, checked_at, checked_by)
    values (p_club, p_key, p_result, app.now(), v_staff)
    on conflict (club_id, check_key) do update set result = excluded.result, checked_at = excluded.checked_at, checked_by = excluded.checked_by;
  perform platform.write_audit('launch_check.recorded', p_club, 'club', p_club::text, jsonb_build_object('check_key', p_key, 'result', p_result), null, null);
end $$;
alter function platform.record_launch_check(uuid, text, text) owner to booq_owner;
revoke all on function platform.record_launch_check(uuid, text, text) from public;
grant execute on function platform.record_launch_check(uuid, text, text) to booq_platform;

revoke insert, update on platform.launch_check from booq_platform;
drop policy launch_check_insert on platform.launch_check;
drop policy launch_check_update on platform.launch_check;

-- Config: one audited function. Any key may be set by an admin; two shapes are checked because they gate other things.
create function platform.set_config_value(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_old jsonb;
  v_removed jsonb;
  v_added jsonb;
  v_detail jsonb := jsonb_build_object('config', p_key);
begin
  if platform.staff_role() is null or not platform.is_admin() then
    raise exception 'config:forbidden' using errcode = 'P0001';
  end if;
  if p_key is null or btrim(p_key) = '' or p_value is null then
    raise exception 'config:invalid_value' using errcode = 'P0001';
  end if;
  if p_key in ('invite_ttl_hours', 'tester_invite_ttl_hours')
     and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <= 0) then
    raise exception 'config:invalid_value' using errcode = 'P0001';
  end if;
  select c.value into v_old from platform.config c where c.key = p_key;
  if p_key = 'required_launch_checks' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0
       or exists (select 1 from jsonb_array_elements(p_value) e(r)
                   where jsonb_typeof(e.r) <> 'object' or jsonb_typeof(e.r -> 'key') <> 'string' or coalesce(e.r ->> 'owed_by', '') not in ('booq', 'owner')
                      or not exists (select 1 from app.launch_producers lp where lp.check_key = e.r ->> 'key'))
       or (select count(distinct e.r ->> 'key') from jsonb_array_elements(p_value) e(r)) <> jsonb_array_length(p_value) then
      raise exception 'config:invalid_value' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(o.k order by o.k), '[]'::jsonb) into v_removed
      from (select e.r ->> 'key' as k from jsonb_array_elements(case when jsonb_typeof(v_old) = 'array' then v_old else '[]'::jsonb end) e(r)
            except select e.r ->> 'key' from jsonb_array_elements(p_value) e(r)) o;
    select coalesce(jsonb_agg(o.k order by o.k), '[]'::jsonb) into v_added
      from (select e.r ->> 'key' as k from jsonb_array_elements(p_value) e(r)
            except select e.r ->> 'key' from jsonb_array_elements(case when jsonb_typeof(v_old) = 'array' then v_old else '[]'::jsonb end) e(r)) o;
    v_detail := v_detail || jsonb_build_object('removed', v_removed, 'added', v_added);
  end if;
  insert into platform.config (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
  perform platform.write_audit('config.changed', null, 'config', p_key, v_detail, null, null);
end $$;
alter function platform.set_config_value(text, jsonb) owner to booq_owner;
revoke all on function platform.set_config_value(text, jsonb) from public;
grant execute on function platform.set_config_value(text, jsonb) to booq_platform;

revoke insert, update on platform.config from booq_platform;
drop policy config_admin_insert on platform.config;
drop policy config_admin_update on platform.config;
