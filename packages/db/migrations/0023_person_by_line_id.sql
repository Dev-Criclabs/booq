-- F02 sign-in, lane D request / migration 0023: app.person_by_line_id(p_line_user_id).
-- Sign-in runs as a guest (no roles), who can read no person, so the lookup is a definer function. The club
-- comes from the context, never from an argument. It returns a row only for an ordinary person
-- (claim_state null): an imported person who has not claimed (no LINE id anyway) and a merged duplicate are
-- not found. An inactive person is returned so sign-in can say the account is inactive. Without a club in the
-- context it returns nothing. booq_app only.
create function app.person_by_line_id(p_line_user_id text)
returns table (id uuid, active boolean, claim_state text)
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  -- plpgsql, not sql: claim_state is added by F02's migration 0103, which runs after this one.
  return query
    select u.id, u.active, u.claim_state
      from public.app_user u
     where u.club_id = app.club_id() and u.line_user_id = p_line_user_id and u.claim_state is null;
end $$;
alter function app.person_by_line_id(text) owner to booq_owner;
revoke all on function app.person_by_line_id(text) from public;
grant execute on function app.person_by_line_id(text) to booq_app;
