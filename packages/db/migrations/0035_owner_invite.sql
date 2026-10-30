-- F01-T23 part b / migration 0035: the owner invite (SR-01, D122), the owner_verified launch check, and the
-- second-admin rule for owner contact changes (review T18 R5). F01 design 5.2 and 7.1; ROLE-02-AC8.
--
--   The owner invite is a club_invite of kind owner (roles owner and player, enforced by the CHECK in 0003),
--   bound to the LINE id in club.owner_line (typed in P2 step 1), single use (app.redeem_invite is atomic),
--   expiring after platform.config 'invite_ttl_hours'. Staff create it only through platform.create_owner_invite,
--   which takes the token's hash from the platform service; no function returns a token (the link is emailed).
--   A fresh invite ends the older unused one.
--   Redemption (a trigger on club_invite) writes P6 and the club audit entry with the redeemer's LINE name and
--   typed phone, records owner_signed_in, and records owner_verified as pass when the typed phone equals
--   club.owner_phone (digits, +66 and 0 forms equal) and fail when not.
--   A failed owner_verified is cleared only by platform.confirm_owner_verified: a platform admin other than the
--   one who created the invite, after checking with the owner by another channel.
--   After an owner invite exists, a change to club.owner_* waits for a different admin to approve it.

insert into platform.config (key, value) values ('invite_ttl_hours', '72'::jsonb)   -- 72 hours is the design's proposal; an admin can change it
  on conflict (key) do nothing;

-- Digits of a phone, with a Thai 0xxxxxxxxx treated as 66xxxxxxxxx, so common typings compare equal.
create function app.phone_digits(p text) returns text
language sql immutable set search_path = pg_catalog
as $$
  select case when d ~ '^0[0-9]{9}$' then '66' || substr(d, 2) else d end
    from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;
alter function app.phone_digits(text) owner to booq_owner;
revoke all on function app.phone_digits(text) from public;
grant execute on function app.phone_digits(text) to booq_owner;

create function platform.create_owner_invite(p_club uuid, p_token_hash text) returns uuid
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_line text;
  v_email text;
  v_ttl numeric;
  v_id uuid;
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    raise exception 'owner_invite:not_found' using errcode = 'P0001';
  end if;
  select nullif(btrim(c.owner_line), ''), nullif(btrim(c.owner_email), '') into v_line, v_email from public.club c where c.id = p_club;
  if v_line is null or v_email is null then
    raise exception 'owner_invite:owner_contact_missing' using errcode = 'P0001';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'owner_invite:token_hash must be the 64 character hex SHA-256 of the token' using errcode = 'P0001';
  end if;
  select (c.value #>> '{}')::numeric into v_ttl from platform.config c where c.key = 'invite_ttl_hours';
  if v_ttl is null or v_ttl <= 0 then
    raise exception 'owner_invite:ttl_not_configured' using errcode = 'P0001';
  end if;
  -- A fresh invite ends the older unused one.
  update public.club_invite
     set expires_at = least(expires_at, greatest(app.now(), created_at + interval '1 microsecond'))
   where club_id = p_club and kind = 'owner' and used_at is null and expires_at > app.now();
  insert into public.club_invite (club_id, token_hash, kind, roles, bound_line_user_id, created_by_staff, expires_at)
    values (p_club, p_token_hash, 'owner', array['owner', 'player'], v_line, v_staff, app.now() + make_interval(secs => v_ttl * 3600))
    returning id into v_id;
  return v_id;
end $$;

-- What P3 shows: status only, and the redeemer beside the owner phone. Never the token.
create function platform.owner_invite_status(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog
as $$
declare
  i public.club_invite%rowtype;
  v_owner_phone text;
  v_name text;
  v_phone text;
  v_status text;
  v_out jsonb;
begin
  if not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    return null;
  end if;
  select * into i from public.club_invite x where x.club_id = p_club and x.kind = 'owner' order by x.created_at desc, x.id limit 1;
  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  v_status := case when i.used_at is not null then 'redeemed' when i.expires_at <= app.now() then 'expired' else 'pending' end;
  v_out := jsonb_build_object('status', v_status, 'created_by', i.created_by_staff, 'created_at', i.created_at, 'expires_at', i.expires_at);
  if v_status = 'redeemed' then
    select u.display_name, u.phone into v_name, v_phone from public.app_user u where u.club_id = p_club and u.id = i.used_by_user;
    select c.owner_phone into v_owner_phone from public.club c where c.id = p_club;
    v_out := v_out || jsonb_build_object('redeemed_at', i.used_at, 'redeemer_name', v_name, 'redeemer_phone', v_phone,
      'owner_phone', v_owner_phone, 'phone_matches', app.phone_digits(v_phone) <> '' and app.phone_digits(v_phone) = app.phone_digits(v_owner_phone));
  end if;
  return v_out;
end $$;

-- Redemption: P6, the club's audit entry, owner_signed_in and owner_verified.
create function app.owner_invite_redeemed() returns trigger
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_name text;
  v_phone text;
  v_owner_phone text;
  v_match boolean;
begin
  select u.display_name, u.phone into v_name, v_phone from public.app_user u where u.club_id = new.club_id and u.id = new.used_by_user;
  select c.owner_phone into v_owner_phone from public.club c where c.id = new.club_id;
  v_match := app.phone_digits(v_phone) <> '' and app.phone_digits(v_phone) = app.phone_digits(v_owner_phone);
  insert into platform.audit_log (action, club_id, target_type, target_id, detail)
    values ('club.owner_invite_redeemed', new.club_id, 'club_invite', new.id::text,
            jsonb_build_object('redeemer_name', v_name, 'redeemer_phone', v_phone, 'phone_matches', v_match));
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
alter function app.owner_invite_redeemed() owner to booq_owner;
revoke all on function app.owner_invite_redeemed() from public;
create trigger club_invite_owner_redeemed after update of used_at on public.club_invite
  for each row when (old.used_at is null and new.used_at is not null and new.kind = 'owner')
  execute function app.owner_invite_redeemed();

create function platform.confirm_owner_verified(p_club uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_creator uuid;
  v_current text;
begin
  if not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    raise exception 'owner_invite:not_found' using errcode = 'P0001';
  end if;
  if not platform.is_admin() then
    raise exception 'owner_invite:admin_only' using errcode = 'P0001';
  end if;
  select i.created_by_staff into v_creator from public.club_invite i
   where i.club_id = p_club and i.kind = 'owner' and i.used_at is not null order by i.used_at desc, i.id limit 1;
  if not found then
    raise exception 'owner_invite:not_redeemed' using errcode = 'P0001';
  end if;
  if v_creator = v_staff then
    raise exception 'owner_invite:same_admin' using errcode = 'P0001';
  end if;
  select c.result into v_current from platform.launch_check c where c.club_id = p_club and c.check_key = 'owner_verified';
  if v_current = 'pass' then
    raise exception 'owner_invite:already_verified' using errcode = 'P0001';
  end if;
  insert into platform.launch_check (club_id, check_key, result, checked_at, checked_by)
    values (p_club, 'owner_verified', 'pass', app.now(), v_staff)
    on conflict (club_id, check_key) do update set result = 'pass', checked_at = app.now(), checked_by = v_staff;
  perform platform.write_audit('club.owner_verified_confirmed', p_club, 'club', p_club::text, '{}'::jsonb, null, null);
end $$;

-- Owner contact changes ------------------------------------------------------------------
create table platform.owner_contact_change (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.club (id),
  requested_by uuid not null references platform.platform_staff (id),
  requested_at timestamptz not null default app.now(),
  changes jsonb not null,
  status text not null default 'pending',
  decided_by uuid references platform.platform_staff (id),
  decided_at timestamptz,
  constraint owner_contact_change_status check (status in ('pending', 'applied', 'rejected')),
  constraint owner_contact_change_decided check ((status = 'pending') = (decided_by is null and decided_at is null))
);
alter table platform.owner_contact_change owner to booq_owner;
revoke all on platform.owner_contact_change from public;
alter table platform.owner_contact_change enable row level security;
grant select on platform.owner_contact_change to booq_platform;
create policy owner_contact_change_select on platform.owner_contact_change for select to booq_platform using (platform.can_see_club(club_id));

-- Direct writes to the four owner columns end here; the functions below are the way in.
revoke update (owner_name, owner_phone, owner_line, owner_email) on public.club from booq_platform;

create function platform.apply_owner_contact(p_club uuid, p_changes jsonb) returns void
language sql security definer set search_path = pg_catalog
as $$
  update public.club set
    owner_name  = case when p_changes ? 'owner_name'  then p_changes ->> 'owner_name'  else owner_name  end,
    owner_phone = case when p_changes ? 'owner_phone' then p_changes ->> 'owner_phone' else owner_phone end,
    owner_line  = case when p_changes ? 'owner_line'  then p_changes ->> 'owner_line'  else owner_line  end,
    owner_email = case when p_changes ? 'owner_email' then p_changes ->> 'owner_email' else owner_email end
  where id = p_club
$$;
alter function platform.apply_owner_contact(uuid, jsonb) owner to booq_owner;
revoke all on function platform.apply_owner_contact(uuid, jsonb) from public;

create function platform.change_owner_contact(p_club uuid, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  k text;
  v_id uuid;
  v_fields jsonb;
begin
  if platform.staff_role() is null or not platform.can_see_club(p_club) or not exists (select 1 from public.club c where c.id = p_club) then
    raise exception 'owner_invite:not_found' using errcode = 'P0001';
  end if;
  if app.club_id() is distinct from p_club then
    raise exception 'owner_invite:club_context' using errcode = 'P0001';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'owner_invite:invalid_field' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('owner_name', 'owner_phone', 'owner_line', 'owner_email')
       or jsonb_typeof(p_changes -> k) <> 'string' or btrim(p_changes ->> k) = '' then
      raise exception 'owner_invite:invalid_field' using errcode = 'P0001';
    end if;
  end loop;
  if not platform.club_editable(p_club) then
    raise exception 'owner_invite:look_only' using errcode = 'P0001';
  end if;
  v_fields := (select jsonb_agg(f order by f) from jsonb_object_keys(p_changes) f);
  if not exists (select 1 from public.club_invite i where i.club_id = p_club and i.kind = 'owner') then
    perform platform.apply_owner_contact(p_club, p_changes);
    perform platform.write_audit('club.owner_contact_changed', p_club, 'club', p_club::text, jsonb_build_object('fields', v_fields), null, null);
    return jsonb_build_object('applied', true);
  end if;
  insert into platform.owner_contact_change (club_id, requested_by, changes) values (p_club, v_staff, p_changes) returning id into v_id;
  perform platform.write_audit('club.owner_contact_requested', p_club, 'club', p_club::text, jsonb_build_object('fields', v_fields), null, null);
  return jsonb_build_object('applied', false, 'request_id', v_id);
end $$;

create function platform.decide_owner_contact_change(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  r platform.owner_contact_change%rowtype;
  v_fields jsonb;
begin
  select * into r from platform.owner_contact_change c where c.id = p_request for update;
  if not found or not platform.can_see_club(r.club_id) then
    raise exception 'owner_invite:not_found' using errcode = 'P0001';
  end if;
  if not platform.is_admin() then
    raise exception 'owner_invite:admin_only' using errcode = 'P0001';
  end if;
  if app.club_id() is distinct from r.club_id then
    raise exception 'owner_invite:club_context' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'owner_invite:not_pending' using errcode = 'P0001';
  end if;
  if r.requested_by = v_staff then
    raise exception 'owner_invite:same_admin' using errcode = 'P0001';
  end if;
  v_fields := (select jsonb_agg(f order by f) from jsonb_object_keys(r.changes) f);
  if p_approve then
    perform platform.apply_owner_contact(r.club_id, r.changes);
  end if;
  update platform.owner_contact_change set status = case when p_approve then 'applied' else 'rejected' end,
         decided_by = v_staff, decided_at = app.now() where id = p_request;
  perform platform.write_audit(case when p_approve then 'club.owner_contact_changed' else 'club.owner_contact_rejected' end,
                               r.club_id, 'club', r.club_id::text, jsonb_build_object('fields', v_fields), null, null);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'platform.create_owner_invite(uuid, text)', 'platform.owner_invite_status(uuid)', 'platform.confirm_owner_verified(uuid)',
    'platform.change_owner_contact(uuid, jsonb)', 'platform.decide_owner_contact_change(uuid, boolean)'
  ] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_platform', f);
  end loop;
end $$;
