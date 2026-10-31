-- F11 / migration 1107: the paused banner's Message BOOQ address (D178). app.shell_state() gains support_line_url: the platform config value
-- booq_support_line_url (a string, no default; the user supplies it before 7 Dec), returned only to the owner and only while the club is Paused.
-- While it is unset the column is null and the button is hidden. It reaches the console through GET /staff/shell, never the player facing public
-- config. A new return column makes a new function, so the one of 1106 is dropped and made again (D159).
drop function app.shell_state();
create function app.shell_state() returns table (pause_reason text, paused_at timestamptz, cap_state text, line_token_reason text, support_line_url text)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_owner boolean := app.has_any_role('owner');
begin
  if v_club is null or not app.has_any_role('owner', 'front_desk', 'accountant') then
    raise exception 'shell: not allowed' using errcode = '42501';
  end if;
  return query
    select p.pause_reason, p.paused_at,
           case when v_owner then app.cap_state() end,
           case when v_owner then (select h.reason from platform.club_health h where h.club_id = v_club and h.check_key = 'line_token' and h.status = 'failed') end,
           case when v_owner and p.pause_reason is not null
                then (select nullif(btrim(c2.value #>> '{}'), '') from platform.config c2 where c2.key = 'booq_support_line_url' and jsonb_typeof(c2.value) = 'string') end
      from (select 1) one
      left join public.club c on c.id = v_club and c.status = 'paused'
      left join public.club_pause p on p.club_id = c.id and p.resumed_at is null;
end $$;
alter function app.shell_state() owner to booq_owner;
revoke all on function app.shell_state() from public;
grant execute on function app.shell_state() to booq_app;
