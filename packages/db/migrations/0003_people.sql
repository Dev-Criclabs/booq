-- F01-T12 / migration 0003: people, roles, consent, invites, testers.
-- F01 design 3.2 and 6.3; FA 2.2 and 4.3. Requirements: ROLE-01 (AC7), PDPA-01-AC2, AC6.
-- Decisions D1 (roles are a set), D100 (test accounts), D102, D115 (every person is also a Player),
-- D122 (owner invite bound to one LINE ID). Review: SR-01 (invite tokens), SR-07.
--
-- F02 adds the profile columns to app_user (migration 0101). Platform staff have no grant here
-- (F01-T18): class D, BOOQ staff never.
-- The test-flag and audit registrations and the foreign keys to platform.platform_staff are in
-- migration 0010: this file runs before 0004 (platform), 0005 (audit) and 0006 (test mode).

create table public.app_user (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  line_user_id text,                      -- null for an imported player who has not signed in yet (D105)
  display_name text,
  active boolean not null default true,
  is_test boolean not null default false, -- only an account made through a tester invite is a test row (D100)
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  constraint app_user_line_unique unique (club_id, line_user_id),
  constraint app_user_line_not_blank check (line_user_id is null or line_user_id <> '')
);

create table public.app_user_role (
  club_id uuid not null,
  user_id uuid not null,
  role text not null,
  granted_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, user_id, role),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  constraint app_user_role_values check (role in ('player', 'coach', 'front_desk', 'accountant', 'owner'))
);

-- Free-text staff notes; split out of app_user so a player reading their own row never receives them (PDPA-01).
create table public.user_staff_note (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  note text not null check (btrim(note) <> ''),
  created_by uuid not null,
  created_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  foreign key (club_id, created_by) references public.app_user (club_id, id)
);

-- Consent is a record and append-only (PDPA-01-AC2).
create table public.user_consent (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  notice_version text not null check (notice_version <> ''),
  language text not null check (language in ('th', 'en')),
  accepted_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id)
);
create trigger user_consent_append_only before update or delete on public.user_consent
  for each row execute function app.refuse_change();
create trigger user_consent_no_truncate before truncate on public.user_consent
  for each statement execute function app.refuse_change();

-- The role set an invite may carry, in one place (used by the CHECK below and the redeem function).
create function app.sorted_roles(r text[]) returns text[]
language sql immutable set search_path = pg_catalog
as $$ select coalesce(array_agg(distinct x order by x), '{}') from unnest(r) x $$;
alter function app.sorted_roles(text[]) owner to booq_owner;
revoke all on function app.sorted_roles(text[]) from public;
grant execute on function app.sorted_roles(text[]) to booq_owner, booq_app, booq_worker, booq_platform;

-- An invite link. The token is 32 random bytes made by the server, stored only as a hash and never
-- returned after creation (SR-01). Every club person also has the Player role (D115).
create table public.club_invite (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  token_hash text not null,
  kind text not null,
  roles text[] not null,
  bound_line_user_id text,
  created_by_staff uuid,                  -- platform staff id; foreign key in 0010 (0004 comes after this file)
  created_by_user uuid,
  created_at timestamptz not null default app.now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_user uuid,                      -- plain uuid: a test account may be purged while the invite stays as history
  primary key (club_id, id),
  foreign key (club_id, created_by_user) references public.app_user (club_id, id),
  constraint club_invite_token_unique unique (token_hash),
  constraint club_invite_token_not_blank check (token_hash <> ''),
  constraint club_invite_kind_values check (kind in ('owner', 'staff', 'coach', 'tester')),
  constraint club_invite_one_creator check (num_nonnulls(created_by_staff, created_by_user) = 1),
  -- BOOQ staff may create only owner and tester invites; staff and coach invites come from a club owner.
  constraint club_invite_platform_kinds check (created_by_staff is null or kind in ('owner', 'tester')),
  constraint club_invite_expiry check (expires_at > created_at),
  constraint club_invite_used_together check ((used_at is null) = (used_by_user is null)),
  constraint club_invite_roles_for_kind check (
    (kind = 'owner' and app.sorted_roles(roles) = array['owner', 'player'])
    or (kind = 'tester' and app.sorted_roles(roles) = array['player'])
    or (kind = 'coach' and app.sorted_roles(roles) = array['coach', 'player'])
    or (kind = 'staff' and app.sorted_roles(roles) @> array['player'] and app.sorted_roles(roles) <@ array['accountant', 'front_desk', 'player'] and cardinality(app.sorted_roles(roles)) > 1)
  ),
  -- An owner invite is for one named person (D122).
  constraint club_invite_owner_bound check (kind <> 'owner' or bound_line_user_id is not null)
);
create index club_invite_open on public.club_invite (club_id, expires_at) where used_at is null;

create table public.club_tester (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  added_by_staff uuid,                    -- platform staff id; foreign key in 0010
  added_at timestamptz not null default app.now(),
  removed_at timestamptz,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, user_id) references public.app_user (club_id, id),
  constraint club_tester_kind_values check (kind in ('owner', 'boq_tester')),
  constraint club_tester_order check (removed_at is null or removed_at >= added_at)
);
create unique index club_tester_active on public.club_tester (club_id, user_id) where removed_at is null;

-- Constraint triggers -------------------------------------------------------------------------
-- (1) An active person holds the Player role, so always at least one role (ROLE-01-AC7, D115).
-- (2) Once a club leaves Draft, removing its last active owner is refused.
-- Both run at commit, so a person and their roles can be written in any order in one transaction.
-- SECURITY DEFINER: they read the tables whatever policy the writer has.
create function app.check_user_player() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
  v_club uuid := (v_row ->> 'club_id')::uuid;
  v_user uuid := (v_row ->> case when tg_table_name = 'app_user' then 'id' else 'user_id' end)::uuid;
begin
  if exists (select 1 from public.app_user u where u.club_id = v_club and u.id = v_user and u.active)
     and not exists (select 1 from public.app_user_role r where r.club_id = v_club and r.user_id = v_user and r.role = 'player') then
    raise exception 'a person keeps the player role (and so at least one role)' using errcode = 'P0001';
  end if;
  return null;
end $$;

create function app.check_club_owner() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := (coalesce(to_jsonb(new), to_jsonb(old)) ->> 'club_id')::uuid;
begin
  if (select c.status from public.club c where c.id = v_club) <> 'draft'
     and not exists (
       select 1 from public.app_user_role r join public.app_user u on u.club_id = r.club_id and u.id = r.user_id
        where r.club_id = v_club and r.role = 'owner' and u.active
     ) then
    raise exception 'a club past Draft keeps at least one active owner' using errcode = 'P0001';
  end if;
  return null;
end $$;
alter function app.check_user_player() owner to booq_owner;
alter function app.check_club_owner() owner to booq_owner;
revoke all on function app.check_user_player() from public;
revoke all on function app.check_club_owner() from public;

create constraint trigger app_user_has_player after insert or update of active on public.app_user
  deferrable initially deferred for each row when (new.active) execute function app.check_user_player();
create constraint trigger app_user_role_has_player after delete or update on public.app_user_role
  deferrable initially deferred for each row execute function app.check_user_player();
-- The owner rule fires only on a change that can remove an owner.
create constraint trigger app_user_role_owner_removed after delete or update on public.app_user_role
  deferrable initially deferred for each row when (old.role = 'owner') execute function app.check_club_owner();
create constraint trigger app_user_deactivated_owner after update of active on public.app_user
  deferrable initially deferred for each row when (old.active and not new.active) execute function app.check_club_owner();

-- Test flag of a person's own rows follows the person (D100): a role, note or consent of a tester
-- account is test data; the same rows of an owner, staff or coach account are never purged.
create function app.copy_user_is_test() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  new.is_test := coalesce((select u.is_test from public.app_user u where u.club_id = new.club_id and u.id = new.user_id), false);
  return new;
end $$;
alter function app.copy_user_is_test() owner to booq_owner;
revoke all on function app.copy_user_is_test() from public;

-- Redeeming an invite: one atomic statement, single use (SR-01, D122). The club comes from the
-- context; the person must already exist in that club with the LINE ID the caller verified.
-- Returns no row when the link is unknown, used, expired, or bound to another LINE ID; the caller
-- cannot tell which. Grants exactly the roles the invite carries.
create function app.redeem_invite(p_token_hash text, p_line_user_id text, p_user uuid)
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
     set used_at = app.now(), used_by_user = p_user
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
alter function app.redeem_invite(text, text, uuid) owner to booq_owner;
revoke all on function app.redeem_invite(text, text, uuid) from public;
grant execute on function app.redeem_invite(text, text, uuid) to booq_app;

-- Ownership, RLS, policies, grants ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['app_user', 'app_user_role', 'user_staff_note', 'user_consent', 'club_invite', 'club_tester'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    -- definer functions owned by booq_owner (the constraint triggers, redeem_invite, the purge)
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- app_user: staff see and edit everyone in the club; a person sees and edits their own row. The
-- accountant has no select (names come through a view, F01-T15); a coach's roster is F07.
create policy app_user_staff on public.app_user for all to booq_app
  using (app.has_any_role('owner', 'front_desk')) with check (app.has_any_role('owner', 'front_desk'));
create policy app_user_self_read on public.app_user for select to booq_app using (id = app.user_id());
create policy app_user_self_write on public.app_user for update to booq_app
  using (id = app.user_id()) with check (id = app.user_id() and active);
create policy app_user_worker on public.app_user for select to booq_worker using (true);
grant select, insert on public.app_user to booq_app;
grant update (display_name, active) on public.app_user to booq_app;
grant select on public.app_user to booq_worker;

create policy app_user_role_read on public.app_user_role for select to booq_app
  using (app.has_any_role('owner', 'front_desk') or user_id = app.user_id());
create policy app_user_role_owner on public.app_user_role for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
create policy app_user_role_worker on public.app_user_role for select to booq_worker using (true);
grant select, insert, delete on public.app_user_role to booq_app;
grant select on public.app_user_role to booq_worker;

create policy user_staff_note_staff on public.user_staff_note for all to booq_app
  using (app.has_any_role('owner', 'front_desk')) with check (app.has_any_role('owner', 'front_desk'));
grant select, insert, update, delete on public.user_staff_note to booq_app;

create policy user_consent_self on public.user_consent for insert to booq_app with check (user_id = app.user_id());
create policy user_consent_read on public.user_consent for select to booq_app
  using (user_id = app.user_id() or app.has_any_role('owner', 'front_desk'));
grant select, insert on public.user_consent to booq_app;

create policy club_invite_owner on public.club_invite for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner') and kind in ('staff', 'coach') and created_by_user = app.user_id());
grant select, insert on public.club_invite to booq_app;

create policy club_tester_owner on public.club_tester for select to booq_app using (app.has_any_role('owner'));
grant select on public.club_tester to booq_app;
