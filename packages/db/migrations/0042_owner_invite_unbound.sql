-- F01-T23 follow-up / migration 0042: decision D151 (owner invite binding), and the Architect's C1 to C4 on 0035.
-- LINE does not give BOOQ staff the owner's internal user id before the owner has signed in, so the invite
-- cannot be bound to a typed value (review T23 B1). It is created unbound and emailed only to club.owner_email
-- (SR-01); the first LINE user who redeems it takes the owner role and the invite binds to them in the same
-- atomic update (one winner, one bound id); later only that user can open it. The person is checked by the typed
-- phone matching club.owner_phone (owner_verified) and, on a mismatch, by a second admin (confirm_owner_verified).
-- club.owner_line stays a contact detail.
--   C1  the binding rule changes in one place, here: the CHECK, the creator and the redeemer together.
--   C2  the P6 entry written at redemption goes through the same key filter as every other P6 entry.
--   C3  platform.owner_contact_change keeps the proposed owner contact; a retention time is for a person to set (note below).
--   C4  two parallel creations leave exactly one live invite (a per-club lock).

alter table public.club_invite drop constraint club_invite_owner_bound;

create or replace function platform.create_owner_invite(p_club uuid, p_token_hash text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_email text;
  v_ttl numeric;
  v_id uuid;
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    raise exception 'owner_invite:not_found' using errcode = 'P0001';
  end if;
  select nullif(btrim(c.owner_email), '') into v_email from public.club c where c.id = p_club;
  if v_email is null then
    raise exception 'owner_invite:owner_contact_missing' using errcode = 'P0001';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'owner_invite:token_hash must be the 64 character hex SHA-256 of the token' using errcode = 'P0001';
  end if;
  select (c.value #>> '{}')::numeric into v_ttl from platform.config c where c.key = 'invite_ttl_hours';
  if v_ttl is null or v_ttl <= 0 then
    raise exception 'owner_invite:ttl_not_configured' using errcode = 'P0001';
  end if;
  -- One creation at a time per club, so "a fresh invite ends the older unused one" holds when two run together (C4).
  perform pg_advisory_xact_lock(hashtextextended('owner_invite:' || p_club::text, 0));
  update public.club_invite
     set expires_at = least(expires_at, greatest(app.now(), created_at + interval '1 microsecond'))
   where club_id = p_club and kind = 'owner' and used_at is null and expires_at > app.now();
  insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at)
    values (p_club, p_token_hash, 'owner', array['owner', 'player'], null, v_staff, app.now() + make_interval(secs => v_ttl * 3600))
    returning id into v_id;
  return v_id;
end $$;

-- Redemption: the same atomic statement as migration 0003, and an owner invite with no bound id binds to the redeemer.
create or replace function app.redeem_invite(p_token_hash text, p_line_user_id text, p_user uuid)
returns table (invite_id uuid, kind text, roles text[])
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_invite public.club_invite%rowtype;
  v_role text;
begin
  if v_club is null then
    raise exception 'redeem_invite needs a club in the context' using errcode = 'P0001';
  end if;
  if p_line_user_id is null or p_line_user_id = '' then
    raise exception 'redeem_invite needs the verified LINE user id' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_user and u.line_user_id = p_line_user_id and u.active) then
    raise exception 'redeem_invite: the person is not that LINE user in this club' using errcode = 'P0001';
  end if;

  update public.club_invite i
     set used_at = app.now(), used_by_user = p_user,
         bound_line_user_id = case when i.kind = 'owner' then coalesce(i.bound_line_user_id, p_line_user_id) else i.bound_line_user_id end
   where i.club_id = v_club and i.token_hash = p_token_hash
     and i.used_at is null and i.expires_at > app.now()
     and (i.bound_line_user_id is null or i.bound_line_user_id = p_line_user_id)
  returning i.* into v_invite;
  if not found then
    return;
  end if;

  foreach v_role in array v_invite.roles loop
    insert into public.app_user_role (club_id, user_id, role) values (v_club, p_user, v_role) on conflict do nothing;
  end loop;
  if v_invite.kind = 'tester' then
    insert into public.club_tester (club_id, user_id, kind) values (v_club, p_user, 'boq_tester') on conflict do nothing;
  end if;
  invite_id := v_invite.id; kind := v_invite.kind; roles := v_invite.roles;
  return next;
end $$;

-- C2: the P6 detail at redemption (the redeemer's LINE name and typed phone, design 7.1, decision D2) is checked by
-- the same filter as every other P6 detail. There is no staff member at redemption, so the entry has no staff id.
create or replace function app.owner_invite_redeemed() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_name text;
  v_phone text;
  v_owner_phone text;
  v_match boolean;
  v_detail jsonb;
begin
  select u.display_name, u.phone into v_name, v_phone from public.app_user u where u.club_id = new.club_id and u.id = new.used_by_user;
  select c.owner_phone into v_owner_phone from public.club c where c.id = new.club_id;
  v_match := app.phone_digits(v_phone) <> '' and app.phone_digits(v_phone) = app.phone_digits(v_owner_phone);
  v_detail := jsonb_build_object('redeemer_name', v_name, 'redeemer_phone', v_phone, 'phone_matches', v_match);
  perform platform.assert_setup_detail(v_detail);
  insert into platform.audit_log (action, club_id, target_type, target_id, detail)
    values ('club.owner_invite_redeemed', new.club_id, 'club_invite', new.id::text, v_detail);
  perform audit.note('owner_invite.redeemed', 'club_invite', new.id, jsonb_build_object('phone_matches', v_match),
                     jsonb_build_object('redeemer_name', v_name, 'redeemer_phone', v_phone));
  insert into platform.launch_check (club_id, check_key, result, checked_at)
    values (new.club_id, 'owner_signed_in', 'pass', app.now())
    on conflict (club_id, check_key) do update set result = 'pass', checked_at = app.now(), checked_by = null;
  insert into platform.launch_check (club_id, check_key, result, checked_at)
    values (new.club_id, 'owner_verified', case when v_match then 'pass' else 'fail' end, app.now())
    on conflict (club_id, check_key) do update set result = excluded.result, checked_at = app.now(), checked_by = null;
  return new;
end $$;

-- C3: the proposed owner contact values (visible to BOOQ staff, D2) stay in this table after a decision. How long
-- they are kept is for a person to decide; until then nothing deletes them.
comment on table platform.owner_contact_change is 'Owner contact changes that need a second admin. changes holds the proposed values (owner contact, visible to BOOQ by D2). Retention time: to be set by a person (review T22-T23 C3).';
