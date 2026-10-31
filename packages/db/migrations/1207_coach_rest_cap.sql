-- F12-T07 / migration 1207: the rest cap for K3 Availability (CPORT-03, D19). F12 design 5.3.
-- The coach's saved hours are kept as typed; the cap (the club setting rest_cap_hours, 6 if the club has not set one, F07 0803) is applied
-- when an hour is offered or booked (F07 coach_check). K3 shows "at most N hours in a row", so the coach reads the number: a coach may not
-- read club_setting (the owner, front desk and accountant do), so this function returns the one value and nothing else of the settings.
create function app.coach_rest_cap() returns integer
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  perform app.portal_coach();
  return app.rest_cap();
end $$;
alter function app.coach_rest_cap() owner to booq_owner;
revoke all on function app.coach_rest_cap() from public;
grant execute on function app.coach_rest_cap() to booq_app;
