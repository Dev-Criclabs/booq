-- F09-T13 / migration 1016: two reads behind the staff closure routes. F09 design 4.6, 4.7; assumption A-7.
-- Requirements: CANCEL-03-AC12, AC15.
--   * app.closure_cancel_limit(): the platform's limit on bookings one closure may end at once, platform.config key
--     closure_cancel_limit, a positive whole number; null when unset (no limit; never a number typed here, A-7). The
--     route passes it to app.create_closure.
--   * app.closure_cancelled_expired_packages(closure): front desk and owner; for A12 after the save, the expired packages
--     whose reserved credit a closure's cancels returned (CANCEL-03-AC12, D85), so the owner can extend them with a reason.

create function app.closure_cancel_limit() returns integer
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$
  select case when jsonb_typeof(value) = 'number' and (value #>> '{}')::numeric > 0 then floor((value #>> '{}')::numeric)::integer end
    from platform.config where key = 'closure_cancel_limit'
$$;
alter function app.closure_cancel_limit() owner to booq_owner;
revoke all on function app.closure_cancel_limit() from public;
grant execute on function app.closure_cancel_limit() to booq_app;

create function app.closure_cancelled_expired_packages(p_closure uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'closure:forbidden' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.closure where club_id = v_club and id = p_closure) then
    raise exception 'closure:not_found' using errcode = 'P0001';
  end if;
  return app.closure_expired_packages(array(select c.booking_id from public.booking_cancel c
                                             where c.club_id = v_club and c.closure_id = p_closure and c.kind = 'closure'));
end $$;
alter function app.closure_cancelled_expired_packages(uuid) owner to booq_owner;
revoke all on function app.closure_cancelled_expired_packages(uuid) from public;
grant execute on function app.closure_cancelled_expired_packages(uuid) to booq_app;
