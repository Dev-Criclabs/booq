-- PLAT-03-AC1, LINE-05-AC14: the platform console tells a club's owner by LINE when BOOQ pauses the club. The message goes
-- through F10's outbox (app.enqueue_message, worker only), so the console reaches it through this one definer.
--   platform.enqueue_owner_message(club, kind, dedupe_key)
--     * platform admin only (a pause is an admin act, D15); the kinds are the owner kinds of F10's catalogue;
--     * the recipient is the club's app_user whose LINE user id is the owner LINE id of setup step 1 (D122). An owner who
--       has not signed in yet has no such person: the call refuses (owner_message:no_recipient) and the console logs it;
--     * the club context is set for the one call and put back; the message holds no club data, only the kind and key.

create function platform.enqueue_owner_message(p_club uuid, p_kind text, p_dedupe_key text) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_before text := current_setting('app.club_id', true);
  v_line text;
  v_user uuid;
  v_id uuid;
begin
  if platform.staff_id() is null or not platform.is_admin() then
    raise exception 'owner_message:forbidden' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('owner_paused', 'owner_cap_paid_over') or p_dedupe_key is null or p_dedupe_key = '' then
    raise exception 'owner_message:invalid' using errcode = 'P0001';
  end if;
  select c.owner_line into v_line from public.club c where c.id = p_club;
  if not found then
    raise exception 'owner_message:not_found' using errcode = 'P0001';
  end if;
  select u.id into v_user from public.app_user u where u.club_id = p_club and v_line is not null and u.line_user_id = v_line;
  if v_user is null then
    raise exception 'owner_message:no_recipient' using errcode = 'P0001';
  end if;
  perform set_config('app.club_id', p_club::text, true);
  v_id := app.enqueue_message(p_kind, v_user, '{}'::jsonb, p_dedupe_key, null);
  perform set_config('app.club_id', coalesce(v_before, ''), true);
  return v_id;
end $$;
alter function platform.enqueue_owner_message(uuid, text, text) owner to booq_owner;
revoke all on function platform.enqueue_owner_message(uuid, text, text) from public;
grant execute on function platform.enqueue_owner_message(uuid, text, text) to booq_platform;
