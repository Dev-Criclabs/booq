-- F02-T01 / migration 0101: the player's own columns on app_user, and the phone-sharing view.
-- F02 design 7.1 and 7.3. Requirements: AUTH-02-AC28, LINE-01-AC14, CC-1; D11 (phone is typed, never
-- verified, shared phones are flagged by a query and never matched silently), D12, D35.
-- The unique (club_id, line_user_id) already exists from migration 0003. The audit registration
-- of app_user (0010) already lists these personal columns as pii, so their values never appear in
-- old_value / new_value.

alter table public.app_user
  add column full_name text,                      -- null until consent
  add column phone text,                          -- as typed
  add column phone_normalized text,               -- computed by the server (packages/domain/phone)
  add column date_of_birth date,                  -- null: Adult prices (D12)
  add column language text,
  add column level text,
  add column line_friend boolean,                 -- true / false / null (unknown)
  add column line_friend_checked_at timestamptz,
  add constraint app_user_language_values check (language in ('th', 'en')),
  add constraint app_user_level_values check (level in ('new', 'beginner', 'intermediate', 'advanced')),
  add constraint app_user_full_name_not_blank check (full_name is null or btrim(full_name) <> ''),
  add constraint app_user_phone_pair check ((phone is null) = (phone_normalized is null)),
  add constraint app_user_phone_digits check (phone_normalized is null or phone_normalized ~ '^[0-9]{6,15}$'),
  add constraint app_user_dob_past check (date_of_birth is null or date_of_birth < date '2100-01-01');

-- Not unique on purpose: a shared phone is allowed and flagged (D11, AUTH-02-AC28).
create index app_user_phone on public.app_user (club_id, phone_normalized) where phone_normalized is not null;

-- The columns a person may change on their own row (Profile). The identity, active flag and test flag are not among them.
grant update (full_name, phone, phone_normalized, date_of_birth, language, level) on public.app_user to booq_app;

-- The webhook (follow / unfollow) and the friendship check record the friend state. Own function,
-- so the webhook needs no update right on app_user and can change nothing else. The club comes from
-- the context; only that one club's person with that LINE id is touched.
create function app.set_line_friend(p_line_user_id text, p_friend boolean) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_n integer;
begin
  if v_club is null then
    raise exception 'set_line_friend needs a club in the context' using errcode = 'P0001';
  end if;
  update public.app_user
     set line_friend = p_friend, line_friend_checked_at = app.now()
   where club_id = v_club and line_user_id = p_line_user_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
alter function app.set_line_friend(text, boolean) owner to booq_owner;
revoke all on function app.set_line_friend(text, boolean) from public;
grant execute on function app.set_line_friend(text, boolean) to booq_app;

-- Who shares a phone within the club (visible to owner and front desk; no stored flag).
create view public.duplicate_phone_flags with (security_barrier = true) as
select u.club_id, u.id, u.phone_normalized,
       (count(*) over (partition by u.club_id, u.phone_normalized))::int as people_with_this_phone
  from public.app_user u
 where u.club_id = app.club_id()
   and app.has_any_role('owner', 'front_desk')
   and u.phone_normalized is not null
   and u.active;
alter view public.duplicate_phone_flags owner to booq_owner;
revoke all on public.duplicate_phone_flags from public;
grant select on public.duplicate_phone_flags to booq_app;

-- app_user_names (F01-T15) gains full_name: appended, as promised there.
create or replace view public.app_user_names with (security_barrier = true) as
select u.club_id, u.id, u.display_name, u.full_name
  from public.app_user u
 where u.club_id = app.club_id()
   and app.has_any_role('owner', 'front_desk', 'accountant');
