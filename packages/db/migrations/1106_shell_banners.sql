-- F11-T02 / migration 1106: what the console banners need (ADMIN-01; F11 design 4). Taken from the F11 block 1101 to 1199 out of task order
-- because the shell route is the first F11 task; the file numbers rise in merge order and only the order inside the block matters.
-- app.shell_state() returns one row for the caller's club: the open pause (reason and since) while the club is Paused, the LINE cap state of
-- this month (F10 app.cap_state: normal, alert, reminders_stopped, over_limit) and whether the LINE token check failed with its reason code.
-- Staff only (owner, front desk, accountant). The cap and token columns are null for anyone but the owner, so only the owner sees those
-- banners (D98, D114). Nothing here is written; platform.club_health is read inside the definer function, never granted to a club role.
create function app.shell_state() returns table (pause_reason text, paused_at timestamptz, cap_state text, line_token_reason text)
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
           case when v_owner then (select h.reason from platform.club_health h where h.club_id = v_club and h.check_key = 'line_token' and h.status = 'failed') end
      from (select 1) one
      left join public.club c on c.id = v_club and c.status = 'paused'
      left join public.club_pause p on p.club_id = c.id and p.resumed_at is null;
end $$;
alter function app.shell_state() owner to booq_owner;
revoke all on function app.shell_state() from public;
grant execute on function app.shell_state() to booq_app;
