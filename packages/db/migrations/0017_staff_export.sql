-- PLAT-06-AC12 / lane D's gap: BOOQ staff start an export, and only start it.
-- A staff member asks through platform.export_request (the P3 route). app.start_staff_export turns that
-- request into the club's data_export row, in the club's context, so the worker builds the file in
-- that club's scope and the owner alone downloads it. BOOQ staff keep no privilege on data_export and see
-- only the status on their own request (PLAT-06-AC12; F01 design 7.5).
--   * the club comes from app.club_id() (set by withPlatformTx), never from an argument;
--   * the caller must be the staff member who made the request and must be able to see the club;
--   * one export per request: calling it again returns the same export.
--   * the request's status follows the export (running, done, failed), so P3 shows progress.

alter table public.data_export
  add column request_id uuid references platform.export_request (id),
  add constraint data_export_request_unique unique (request_id),
  add constraint data_export_staff_fk foreign key (requested_by_staff) references platform.platform_staff (id);

create function app.start_staff_export(p_request uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  r platform.export_request%rowtype;
  v_id uuid;
begin
  if v_club is null then
    raise exception 'start_staff_export needs a club in the context' using errcode = 'P0001';
  end if;
  select * into r from platform.export_request where id = p_request;
  if not found or r.club_id <> v_club or r.requested_by_staff is distinct from v_staff
     or v_staff is null or not platform.can_see_club(v_club) then
    raise exception 'export:not_found' using errcode = 'P0001';     -- someone else's request and a missing one look the same
  end if;
  select id into v_id from public.data_export where club_id = v_club and request_id = p_request;
  if found then
    return v_id;
  end if;
  insert into public.data_export (club_id, kind, requested_by_staff, request_id, status)
  values (v_club, 'club', v_staff, p_request, 'requested')
  returning id into v_id;
  update platform.export_request set status = 'running' where id = p_request and status = 'requested';
  return v_id;
end $$;
alter function app.start_staff_export(uuid) owner to booq_owner;
revoke all on function app.start_staff_export(uuid) from public;
grant execute on function app.start_staff_export(uuid) to booq_platform;

-- The request mirrors the export's progress: BOOQ staff see a status and nothing else.
create function app.mirror_export_status() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if new.request_id is not null and new.status is distinct from old.status then
    update platform.export_request
       set status = case new.status when 'done' then 'done' when 'failed' then 'failed' else 'running' end
     where id = new.request_id;
  end if;
  return null;
end $$;
alter function app.mirror_export_status() owner to booq_owner;
revoke all on function app.mirror_export_status() from public;
create trigger data_export_mirror_status after update of status on public.data_export
  for each row execute function app.mirror_export_status();
