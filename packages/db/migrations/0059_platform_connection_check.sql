-- D167, PLAT-02-AC8, LINE-06: when BOOQ staff save a LINE or Beam connection in the console, the result of the probe on the values
-- just typed is recorded in platform.club_health, so P1 shows a connection that was saved although its check failed ("save anyway"),
-- and a later pass clears it. The console holds no key that can read a stored secret (SR-03): this records a code only.
--   platform.record_connection_check(club, check, reason)
--     * check: line_token, beam_keys or beam_charge (the keys of F10's 0604 and BE-C's 0699); reason null: ok, else a short code;
--     * the caller is a platform staff member who may see the club and may change it now (platform.club_editable);
--     * changed_at moves only when the status changes, checked_at every time (like app.report_payment_health).

create function platform.record_connection_check(p_club uuid, p_check text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text := case when p_reason is null then 'ok' else 'failed' end;
begin
  if platform.staff_id() is null then
    raise exception 'connection_check:forbidden' using errcode = 'P0001';
  end if;
  if not platform.can_see_club(p_club) or not platform.club_editable(p_club) then
    raise exception 'connection_check:forbidden' using errcode = 'P0001';
  end if;
  if p_check is null or p_check not in ('line_token', 'beam_keys', 'beam_charge') then
    raise exception 'connection_check:invalid' using errcode = 'P0001';
  end if;
  if p_reason is not null and p_reason !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'connection_check:invalid' using errcode = 'P0001';
  end if;
  insert into platform.club_health as h (club_id, check_key, status, reason, changed_at, checked_at)
  values (p_club, p_check, v_status, p_reason, app.now(), app.now())
  on conflict (club_id, check_key) do update
    set status = excluded.status,
        reason = excluded.reason,
        changed_at = case when h.status is distinct from excluded.status then app.now() else h.changed_at end,
        checked_at = app.now();
end $$;
alter function platform.record_connection_check(uuid, text, text) owner to booq_owner;
revoke all on function platform.record_connection_check(uuid, text, text) from public;
grant execute on function platform.record_connection_check(uuid, text, text) to booq_platform;

-- "Test all again" (D167): the console never decrypts a stored secret (SR-03), so a recheck of what is stored is a request the worker
-- answers. platform.request_connection_check asks; the worker (a task polling this table, like the outbox sender) decrypts with its
-- own key, runs probeLine and probeBeam, reports each result with app.report_connection_check and removes the request.
--   platform.connection_check_request   one open request per club (class P); the console reads it to show "checking"
--   platform.request_connection_check(club)  any staff member who may see the club, also a Live one (a support visit is read only)
--   app.due_connection_check_clubs(limit) / app.report_connection_check(check, reason) / app.finish_connection_check()  worker only

create table platform.connection_check_request (
  club_id uuid primary key references public.club (id),
  requested_at timestamptz not null default app.now(),
  requested_by uuid not null references platform.platform_staff (id)
);
alter table platform.connection_check_request owner to booq_owner;
revoke all on platform.connection_check_request from public;
alter table platform.connection_check_request enable row level security;
grant select on platform.connection_check_request to booq_platform;
create policy connection_check_request_select on platform.connection_check_request for select to booq_platform using (platform.can_see_club(club_id));

create function platform.request_connection_check(p_club uuid) returns timestamptz
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_staff uuid := platform.staff_id();
  v_at timestamptz;
begin
  if v_staff is null or not platform.can_see_club(p_club) then
    raise exception 'connection_check:forbidden' using errcode = 'P0001';
  end if;
  insert into platform.connection_check_request (club_id, requested_by) values (p_club, v_staff)
  on conflict (club_id) do update set requested_at = app.now(), requested_by = excluded.requested_by
  returning requested_at into v_at;
  perform platform.write_audit('support.connection_check_requested', p_club, 'club', p_club::text, '{}'::jsonb, null, null);
  return v_at;
end $$;
alter function platform.request_connection_check(uuid) owner to booq_owner;
revoke all on function platform.request_connection_check(uuid) from public;
grant execute on function platform.request_connection_check(uuid) to booq_platform;

create function app.due_connection_check_clubs(p_limit integer) returns setof uuid
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select r.club_id from platform.connection_check_request r order by r.requested_at, r.club_id limit greatest(coalesce(p_limit, 0), 0)
$$;

create function app.report_connection_check(p_check text, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_status text := case when p_reason is null then 'ok' else 'failed' end;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'report_connection_check: not allowed' using errcode = '42501';
  end if;
  if p_check is null or p_check not in ('line_token', 'beam_keys', 'beam_charge') or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,40}$') then
    raise exception 'report_connection_check: invalid' using errcode = '22023';
  end if;
  insert into platform.club_health as h (club_id, check_key, status, reason, changed_at, checked_at)
  values (v_club, p_check, v_status, p_reason, app.now(), app.now())
  on conflict (club_id, check_key) do update
    set status = excluded.status,
        reason = excluded.reason,
        changed_at = case when h.status is distinct from excluded.status then app.now() else h.changed_at end,
        checked_at = app.now();
end $$;

create function app.finish_connection_check() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if app.club_id() is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'finish_connection_check: not allowed' using errcode = '42501';
  end if;
  delete from platform.connection_check_request where club_id = app.club_id();
end $$;

-- What the recheck needs to know about the club besides its secrets: the club's status (which Beam key set is in use) and the ids of the
-- connections (no secret). The worker has no table grant on the connection tables.
create function app.connection_check_facts() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'connection_check_facts: not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'status', (select c.status from public.club c where c.id = v_club),
    'line', (select jsonb_build_object('login_channel_id', l.login_channel_id, 'liff_id', l.liff_id) from public.line_connection l where l.club_id = v_club),
    'payments', (select jsonb_build_object('merchant_id_test', p.merchant_id_test, 'merchant_id_live', p.merchant_id_live) from public.payment_connection p where p.club_id = v_club)
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.due_connection_check_clubs(integer)', 'app.report_connection_check(text, text)', 'app.finish_connection_check()', 'app.connection_check_facts()'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_worker', f);
  end loop;
end $$;
