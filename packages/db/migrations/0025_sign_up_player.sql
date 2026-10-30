-- F02-T09 lane D request / migration 0025: app.sign_up_player.
-- First sign-in of a new person: in one transaction it checks the pending_profile session, inserts the person
-- (the session's LINE id and pending display name, the typed profile), the player role and the consent record,
-- and replaces the pending session by an active one with the same token hash. It returns the new user id.
--   * The club comes from the context; the session must belong to it, be pending and not expired.
--   * is_test is derived here, never passed in (D100): in a Draft or Testing club the caller must present the
--     hash of a valid, unused, unexpired owner or tester link (bound to this LINE id if bound); a tester link
--     makes a test account, an owner link a real person. In a Live or Paused club the flag is false and the
--     invite hash is ignored. A Draft or Testing club with no valid link refuses: sign_up:not_a_tester.
--   * The invite is not consumed here; redeem_invite does that afterwards, in the caller's transaction.
--   * The session cannot be updated in place: is_test never changes on a row, and a test account's session
--     must be a test row (it is purged with the account). So the pending row is deleted and the active one is
--     inserted with the same token hash; the cookie keeps working.
--   * app.request_claim is not called here (lane D's service calls it, same transaction).
-- p_invite_hash is the one parameter beyond lane D's list; it is how the flag is derived without trusting a boolean.
create function app.sign_up_player(
  p_session_token_hash text, p_full_name text, p_phone text, p_phone_normalized text, p_language text,
  p_notice_version text, p_consent_language text, p_invite_hash text default null
) returns uuid
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_status text;
  -- No %rowtype: auth_session is created by F02's migration 0102, after this one.
  v_sid uuid;
  v_line text;
  v_name text;
  v_created timestamptz;
  v_expires timestamptz;
  v_invite_kind text;
  v_test boolean := false;
  v_user uuid;
begin
  if v_club is null then
    raise exception 'sign_up_player needs a club in the context' using errcode = 'P0001';
  end if;
  select s.id, s.line_user_id, s.pending_display_name, s.created_at, s.expires_at
    into v_sid, v_line, v_name, v_created, v_expires
    from public.auth_session s
   where s.club_id = v_club and s.token_hash = p_session_token_hash
     and s.state = 'pending_profile' and s.revoked_at is null and s.expires_at > app.now()
   for update;
  if not found then
    raise exception 'sign_up:no_pending_session' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.app_user u where u.club_id = v_club and u.line_user_id = v_line) then
    raise exception 'sign_up:already_registered' using errcode = 'P0001';
  end if;

  select c.status into v_status from public.club c where c.id = v_club;
  if v_status in ('draft', 'testing') then
    select i.kind into v_invite_kind from public.club_invite i
     where i.club_id = v_club and i.token_hash = p_invite_hash and i.kind in ('owner', 'tester')
       and i.used_at is null and i.expires_at > app.now()
       and (i.bound_line_user_id is null or i.bound_line_user_id = v_line);
    if v_invite_kind is null then
      raise exception 'sign_up:not_a_tester' using errcode = 'P0001';
    end if;
    v_test := v_invite_kind = 'tester';
  end if;

  insert into public.app_user (club_id, line_user_id, display_name, full_name, phone, phone_normalized, language, is_test)
    values (v_club, v_line, v_name, p_full_name, p_phone, p_phone_normalized, p_language, v_test)
    returning id into v_user;
  insert into public.app_user_role (club_id, user_id, role) values (v_club, v_user, 'player');
  insert into public.user_consent (club_id, user_id, notice_version, language) values (v_club, v_user, p_notice_version, p_consent_language);

  delete from public.auth_session where club_id = v_club and id = v_sid;
  insert into public.auth_session (club_id, token_hash, user_id, line_user_id, state, created_at, expires_at)
    values (v_club, p_session_token_hash, v_user, v_line, 'active', v_created, v_expires);
  return v_user;
end $$;
alter function app.sign_up_player(text, text, text, text, text, text, text, text) owner to booq_owner;
revoke all on function app.sign_up_player(text, text, text, text, text, text, text, text) from public;
grant execute on function app.sign_up_player(text, text, text, text, text, text, text, text) to booq_app;
