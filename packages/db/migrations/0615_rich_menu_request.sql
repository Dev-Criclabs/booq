-- F10-T15 / migration 0615: rich_menu_request, how a label save (and, F10-T16, P2's Upload and Redo) asks for a rich menu
-- build (D176, orchestrator 31 Oct). Requirements LINE-02-AC8; decisions D114, D149. The web cannot build the menu: the
-- channel token is read by the worker only (D149) and the queue is the worker's. So the save writes its labels and a
-- request in one transaction; the worker polls the requests on the outbox sender's tick (like connection_check, 0059),
-- takes one and runs buildRichMenu (F10-T12). A16 reads the result from GET /staff/rich-menu.
--   public.rich_menu_request             one open request per club (class S); a second save before pick up updates it,
--                                        so the build runs once; force (Redo) is kept once asked for
--   app.request_rich_menu_build()        the owner, in the club's context (PUT /staff/rich-menu/labels); audited
--   app.due_rich_menu_clubs(limit)       worker: the clubs with a request, oldest first
--   app.take_rich_menu_request()         worker, in the club's context: removes the request and returns its force, or
--                                        null when another worker took it first

create table public.rich_menu_request (
  club_id uuid primary key references public.club (id),
  force boolean not null default false,
  requested_at timestamptz not null default app.now(),
  requested_by uuid                             -- the club person who asked; null for a platform request (F10-T16)
);
alter table public.rich_menu_request owner to booq_owner;
revoke all on public.rich_menu_request from public;
alter table public.rich_menu_request enable row level security;
alter table public.rich_menu_request force row level security;
create policy rich_menu_request_tenant on public.rich_menu_request as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy rich_menu_request_definer on public.rich_menu_request for all to booq_owner using (true) with check (true);
-- The owner sees that a build is waiting (A16 shows it as building); writes go through the definer below only.
grant select on public.rich_menu_request to booq_app;
create policy rich_menu_request_owner_read on public.rich_menu_request for select to booq_app using (app.has_any_role('owner'));

create function app.request_rich_menu_build() returns timestamptz
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_at timestamptz;
begin
  if v_club is null or not app.has_any_role('owner') then
    raise exception 'request_rich_menu_build is for the club owner' using errcode = '42501';
  end if;
  insert into public.rich_menu_request as r (club_id, force, requested_by) values (v_club, false, app.user_id())
  on conflict (club_id) do update set requested_at = app.now(), requested_by = excluded.requested_by, force = r.force or excluded.force
  returning requested_at into v_at;
  perform audit.note('rich_menu.build_requested', 'club', v_club, '{}'::jsonb);
  return v_at;
end $$;
alter function app.request_rich_menu_build() owner to booq_owner;
revoke all on function app.request_rich_menu_build() from public;
grant execute on function app.request_rich_menu_build() to booq_app;

create function app.due_rich_menu_clubs(p_limit integer) returns setof uuid
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select r.club_id from public.rich_menu_request r order by r.requested_at, r.club_id limit greatest(coalesce(p_limit, 0), 0)
$$;
alter function app.due_rich_menu_clubs(integer) owner to booq_owner;
revoke all on function app.due_rich_menu_clubs(integer) from public;
grant execute on function app.due_rich_menu_clubs(integer) to booq_worker;

create function app.take_rich_menu_request() returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_force boolean;
begin
  if app.club_id() is null then
    raise exception 'take_rich_menu_request needs a club in the context' using errcode = '42501';
  end if;
  delete from public.rich_menu_request where club_id = app.club_id() returning force into v_force;
  return v_force;
end $$;
alter function app.take_rich_menu_request() owner to booq_owner;
revoke all on function app.take_rich_menu_request() from public;
grant execute on function app.take_rich_menu_request() to booq_worker;
