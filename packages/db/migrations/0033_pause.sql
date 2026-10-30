-- F01-T22 / migration 0033: pause and resume (PLAT-03-AC1, AC2, AC3, AC7, AC10, AC11; PLAT-01-AC10).
-- F01 design 4.2. Only a platform admin pauses or resumes (D15), always with a reason.
-- Both functions are SECURITY DEFINER with a fixed search path, executable by booq_platform only.
-- The club comes from app.club_id() and the actor from app.actor_platform_staff_id (withPlatformTx);
-- the admin, assignment, reason and transition checks are app.apply_status_change's (migration 0032),
-- called here with via_pause = true. The club's own audit entry is the table trigger's update entry.
-- Refusing new holds while Paused is F03's check (club_paused in reserve_court); the banner state is
-- club.status plus the open club_pause row. The owner's LINE message goes through the outbox interface
-- in apps/platform (a stub until F10).

-- Registry of work to do when a club resumes. A later feature adds a row in its own migration (F06
-- registers the package and wallet expiry shift, PLAT-03-AC7). The handler takes
-- (club uuid, paused_at timestamptz, resumed_at timestamptz). Nobody but the owner role can write it.
create table app.pause_handlers (
  handler_key text primary key check (handler_key <> ''),
  handler regprocedure not null,
  created_at timestamptz not null default app.now()
);
alter table app.pause_handlers owner to booq_owner;
revoke all on app.pause_handlers from public;

create policy club_pause_owner_role on public.club_pause for all to booq_owner
  using (club_id = app.club_id()) with check (club_id = app.club_id());

create function app.pause_club(p_reason text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_id uuid;
begin
  perform app.apply_status_change('paused', p_reason, true);
  insert into public.club_pause (club_id, pause_reason, paused_by)
    values (v_club, btrim(p_reason), v_staff)
    returning id into v_id;
  return v_id;
end $$;

create function app.resume_club(p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_paused timestamptz;
  v_resumed timestamptz := app.now();
  v_n integer := 0;
  h record;
begin
  perform app.apply_status_change('live', p_reason, true);
  update public.club_pause
     set resumed_at = v_resumed, resume_reason = btrim(p_reason), resumed_by = v_staff
   where club_id = v_club and resumed_at is null
  returning paused_at into v_paused;
  if v_paused is null then
    raise exception 'club_status:not_paused' using errcode = 'P0001';
  end if;
  -- Handlers run in key order, in this transaction: one that fails undoes the whole resume.
  for h in select handler from app.pause_handlers order by handler_key loop
    execute format('select %s($1, $2, $3)', h.handler::regproc::text) using v_club, v_paused, v_resumed;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('paused_at', v_paused, 'resumed_at', v_resumed, 'handlers_run', v_n);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.pause_club(text)', 'app.resume_club(text)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_platform', f);
  end loop;
end $$;
