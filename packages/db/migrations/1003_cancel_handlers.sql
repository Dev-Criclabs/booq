-- F09-T03 / migration 1003: the registry app.cancel_handlers. F09 design 4.3.
-- Requirements: CANCEL-01-AC13, AC17, AC19.
--
-- Same pattern as F03's app.release_handlers (0210): a feature that reacts to a cancel registers one handler
-- from its own migration with app.register_cancel_handler(name, handler, ord). The ord rule (design 4.3):
-- F07 20 (the coach is freed and told), F08 30 (class seat and waitlist_advance), F14 40 (referral status).
-- app.run_cancel_handlers(booking, kind) calls each as handler(club uuid, booking uuid, kind text), in ord then
-- name order, inside the caller's transaction: app.cancel_booking (F09-T06b) calls it after the status, the
-- occupancy and the booking_cancel row are written, so a handler failure rolls the whole cancel back. Each handler
-- must be idempotent. Messages are not handlers (F09 enqueues them, design 4.9). kind is a booking_cancel kind.
-- Neither function is granted to an app role: registration is done by migrations, the run by F09's definer
-- functions, which execute as the owner.

create table app.cancel_handlers (
  name text primary key check (name <> ''),
  handler regprocedure not null,
  ord integer not null
);
alter table app.cancel_handlers owner to booq_owner;
revoke all on app.cancel_handlers from public;

create function app.register_cancel_handler(p_name text, p_handler regprocedure, p_ord integer) returns void
language sql set search_path = pg_catalog, pg_temp
as $$ insert into app.cancel_handlers (name, handler, ord) values (p_name, p_handler, p_ord) $$;
alter function app.register_cancel_handler(text, regprocedure, integer) owner to booq_owner;
revoke all on function app.register_cancel_handler(text, regprocedure, integer) from public;

create function app.run_cancel_handlers(p_booking uuid, p_kind text) returns void
language plpgsql set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  h record;
begin
  if v_club is null then
    raise exception 'run_cancel_handlers needs a club in the context' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('player_cancel', 'staff_cancel', 'club_cancel', 'closure', 'late_cancel_mark', 'no_show_mark', 'reversal') then
    raise exception 'unknown cancel kind' using errcode = '22023';
  end if;
  -- Called by schema and name with typed arguments, so an overloaded name still reaches the registered one.
  for h in select n.nspname, p.proname
             from app.cancel_handlers c
             join pg_catalog.pg_proc p on p.oid = c.handler
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            order by c.ord, c.name loop
    execute format('select %I.%I($1::uuid, $2::uuid, $3::text)', h.nspname, h.proname) using v_club, p_booking, p_kind;
  end loop;
end $$;
alter function app.run_cancel_handlers(uuid, text) owner to booq_owner;
revoke all on function app.run_cancel_handlers(uuid, text) from public;
