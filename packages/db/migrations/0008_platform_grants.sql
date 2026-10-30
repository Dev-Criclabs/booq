-- F01-T18 / migration 0008 (platform part): what BOOQ staff may do. F01 design 6.3; FA 4.4.
-- Requirements: PLAT-02-AC1 to AC9, PDPA-01-AC1, PLAT-04-AC5. Review SR-02.
--
-- Layers: (1) booq_platform has no privilege on any club data (D) table, so a wrong policy
-- cannot open one; (2) on setup (S) tables it has column and table grants; (3) row policies
-- decide per staff member: an admin sees every club, a specialist the assigned ones; writes
-- only while the club is Draft or Testing, or while the owner's window is open (it ends by
-- itself, the policy reads the clock). Look only otherwise, and Paused is look only (D27).
-- Secret tables (club_secret and the connections) get their grants in F01-T09.
-- Tables of club data are not touched here; they have no grant to booq_platform.

-- The staff member comes from the transaction (withPlatformTx). Nothing is trusted about role
-- or assignment from the setting: both are read from the platform tables.
create function platform.staff_id() returns uuid
language sql stable set search_path = pg_catalog
as $$ select nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid $$;

-- The helpers read platform tables as booq_owner (they bypass the tables' row security), so a
-- policy that calls them does not recurse.
create function platform.staff_role() returns text
language sql stable security definer set search_path = pg_catalog
as $$ select s.role from platform.platform_staff s where s.id = platform.staff_id() and s.active $$;

create function platform.is_admin() returns boolean
language sql stable security definer set search_path = pg_catalog
as $$ select coalesce(platform.staff_role() = 'platform_admin', false) $$;

create function platform.can_see_club(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select exists (
    select 1 from platform.platform_staff s
     where s.id = platform.staff_id() and s.active
       and (s.role = 'platform_admin'
            or exists (select 1 from platform.staff_assignment a where a.staff_id = s.id and a.club_id = p_club))
  )
$$;

-- Invoker on purpose: it reads the club row through the caller's own policy (club_platform_read).
create function platform.club_editable(p_club uuid) returns boolean
language sql stable set search_path = pg_catalog
as $$
  select exists (
    select 1 from public.club c
     where c.id = p_club
       and (c.status in ('draft', 'testing') or c.allow_booq_changes_until > app.now())
  )
$$;

-- Sign in looks a staff member up before any identity is known; it returns only that row.
create function platform.staff_by_auth_user(p_auth uuid) returns table (id uuid, auth_user_id uuid, display_name text, role text, active boolean)
language sql stable security definer set search_path = pg_catalog
as $$ select s.id, s.auth_user_id, s.display_name, s.role, s.active from platform.platform_staff s where s.auth_user_id = p_auth $$;

create function platform.staff_by_id(p_id uuid) returns table (id uuid, auth_user_id uuid, display_name text, role text, active boolean)
language sql stable security definer set search_path = pg_catalog
as $$ select s.id, s.auth_user_id, s.display_name, s.role, s.active from platform.platform_staff s where s.id = p_id $$;

-- P6 writer (FA 8.2). The staff member comes from the transaction. Detail may hold setup facts
-- only: a key that names players, bookings, payments, slips, receipts, wallets, notes or
-- secrets is refused at any depth. Owner contact columns (decision D2) and secret_last4 are fine.
create function platform.assert_setup_detail(j jsonb) returns void
language plpgsql immutable set search_path = pg_catalog
as $$
declare k text;
begin
  case jsonb_typeof(j)
    when 'object' then
      for k in select jsonb_object_keys(j) loop
        if k <> 'secret_last4' and (
             k in ('date_of_birth', 'line_user_id')
             or string_to_array(k, '_') && array['dob', 'birthday', 'booking', 'bookings', 'slip', 'slips', 'receipt', 'receipts',
                                                  'wallet', 'balance', 'customer', 'customers', 'player', 'players',
                                                  'note', 'notes', 'password', 'token', 'secret', 'hmac', 'ciphertext', 'key']
           ) then
          raise exception 'platform audit detail: "%" is not allowed (player, payment or secret data)', k using errcode = 'P0001';
        end if;
        perform platform.assert_setup_detail(j -> k);
      end loop;
    when 'array' then
      for k in select i::text from generate_series(0, jsonb_array_length(j) - 1) as i loop
        perform platform.assert_setup_detail(j -> k::int);
      end loop;
    else null;
  end case;
end $$;

create function platform.write_audit(
  p_action text, p_club uuid, p_target_type text, p_target_id text, p_detail jsonb, p_reason text, p_support_session uuid
) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_name text;
begin
  if v_staff is not null then
    select s.display_name into v_name from platform.platform_staff s where s.id = v_staff and s.active;
    if v_name is null then
      raise exception 'platform audit: unknown or inactive staff member' using errcode = 'P0001';
    end if;
  elsif p_action not like 'auth.%' then
    raise exception 'platform audit: a staff member is required' using errcode = 'P0001';
  end if;
  perform platform.assert_setup_detail(coalesce(p_detail, '{}'::jsonb));
  insert into platform.audit_log (staff_id, staff_name_at_time, action, club_id, target_type, target_id, detail, reason, support_session_id)
    values (v_staff, v_name, p_action, p_club, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb), p_reason, p_support_session);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'platform.staff_id()', 'platform.staff_role()', 'platform.is_admin()', 'platform.can_see_club(uuid)',
    'platform.club_editable(uuid)', 'platform.staff_by_auth_user(uuid)', 'platform.staff_by_id(uuid)',
    'platform.assert_setup_detail(jsonb)',
    'platform.write_audit(text, uuid, text, text, jsonb, text, uuid)'
  ] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_platform', f);
  end loop;
end $$;

-- Row security on every platform table, as a second layer behind the grants. Not forced: the
-- definer functions run as the table owner and are the only other writers.
do $$
declare t text;
begin
  foreach t in array array['platform_staff', 'staff_assignment', 'support_session', 'audit_log', 'club_usage_daily',
                           'config', 'template', 'template_item', 'launch_check', 'export_request'] loop
    execute format('alter table platform.%I enable row level security', t);
  end loop;
end $$;

-- Platform tables ----------------------------------------------------------------------
grant select on platform.platform_staff, platform.staff_assignment, platform.support_session, platform.audit_log,
  platform.club_usage_daily, platform.config, platform.template, platform.template_item,
  platform.launch_check, platform.export_request to booq_platform;
grant insert, update (display_name, role, active) on platform.platform_staff to booq_platform;
grant insert, delete on platform.staff_assignment to booq_platform;
grant insert, update (closed_at) on platform.support_session to booq_platform;
grant update (value) on platform.config to booq_platform;
grant insert, update on platform.launch_check to booq_platform;   -- admin only by policy, until a definer function records results (review R2)
grant insert on platform.export_request to booq_platform;

create policy staff_select on platform.platform_staff for select to booq_platform using (platform.is_admin() or id = platform.staff_id());
create policy staff_admin_insert on platform.platform_staff for insert to booq_platform with check (platform.is_admin());
create policy staff_admin_update on platform.platform_staff for update to booq_platform using (platform.is_admin()) with check (platform.is_admin());

create policy assignment_select on platform.staff_assignment for select to booq_platform using (platform.is_admin() or staff_id = platform.staff_id());
create policy assignment_admin_insert on platform.staff_assignment for insert to booq_platform with check (platform.is_admin());
create policy assignment_admin_delete on platform.staff_assignment for delete to booq_platform using (platform.is_admin());

create policy support_select on platform.support_session for select to booq_platform using (platform.is_admin() or staff_id = platform.staff_id());
create policy support_insert on platform.support_session for insert to booq_platform
  with check (staff_id = platform.staff_id() and platform.can_see_club(club_id));
create policy support_close on platform.support_session for update to booq_platform
  using (staff_id = platform.staff_id()) with check (staff_id = platform.staff_id());

create policy audit_log_admin_select on platform.audit_log for select to booq_platform using (platform.is_admin());

create policy usage_select on platform.club_usage_daily for select to booq_platform using (platform.can_see_club(club_id));

create policy config_select on platform.config for select to booq_platform using (platform.staff_role() is not null);
create policy config_admin_update on platform.config for update to booq_platform using (platform.is_admin()) with check (platform.is_admin());

create policy template_select on platform.template for select to booq_platform using (platform.staff_role() is not null);
create policy template_item_select on platform.template_item for select to booq_platform using (platform.staff_role() is not null);

create policy launch_check_select on platform.launch_check for select to booq_platform using (platform.can_see_club(club_id));
-- Results are written by an admin only. A specialist cannot mark a check as passed: Go live is gated
-- on every check passing. A definer function that runs or reads the real check replaces this later.
create policy launch_check_insert on platform.launch_check for insert to booq_platform
  with check (platform.is_admin() and platform.can_see_club(club_id) and (checked_by is null or checked_by = platform.staff_id()));
create policy launch_check_update on platform.launch_check for update to booq_platform
  using (platform.is_admin() and platform.can_see_club(club_id))
  with check (platform.is_admin() and platform.can_see_club(club_id) and (checked_by is null or checked_by = platform.staff_id()));

create policy export_select on platform.export_request for select to booq_platform using (platform.can_see_club(club_id));
create policy export_insert on platform.export_request for insert to booq_platform
  with check (platform.can_see_club(club_id) and requested_by_staff = platform.staff_id());

-- Setup (S) tables ---------------------------------------------------------------------
-- club: a creator who is not yet assigned cannot read the new row back, so the create route
-- supplies the id and does not use RETURNING; an admin assigns the club (F01-T23).
-- club: no UPDATE on status, allow_booq_changes_until or allow_booq_changes_set_at (SR-02); a new
-- club starts as Draft because status cannot be inserted. The window is written only by
-- app.set_support_window (F01-T19) and the status only by app.set_club_status (F01-T20).
grant select on public.club to booq_platform;
grant insert (id, slug, name_th, name_en, legal_name, tax_id, tax_branch, registered_address, payment_option, template_id,
              receipt_prefix, default_language, owner_name, owner_phone, owner_line, owner_email,
              plan_trial_ends_at, billing_starts_at, created_by_staff)
  on public.club to booq_platform;
grant update (slug, name_th, name_en, legal_name, tax_id, tax_branch, registered_address, payment_option, template_id,
              receipt_prefix, default_language, owner_name, owner_phone, owner_line, owner_email,
              plan_trial_ends_at, billing_starts_at)
  on public.club to booq_platform;

create policy club_platform_read on public.club for select to booq_platform using (platform.can_see_club(id));
create policy club_platform_insert on public.club for insert to booq_platform
  with check (platform.staff_role() is not null and created_by_staff = platform.staff_id());
create policy club_platform_update on public.club for update to booq_platform
  using (platform.can_see_club(id) and platform.club_editable(id))
  with check (platform.can_see_club(id) and platform.club_editable(id));

grant select on public.club_pause to booq_platform;
create policy club_pause_platform_read on public.club_pause for select to booq_platform using (platform.can_see_club(club_id));

do $$
declare t text;
begin
  foreach t in array array['club_feature', 'club_setting', 'location', 'resource', 'opening_hours'] loop
    execute format('grant select, insert, update, delete on public.%I to booq_platform', t);
    execute format($f$create policy %1$s_platform_read on public.%1$I for select to booq_platform using (platform.can_see_club(club_id))$f$, t);
    execute format($f$create policy %1$s_platform_write on public.%1$I for all to booq_platform
                      using (platform.can_see_club(club_id) and platform.club_editable(club_id))
                      with check (platform.can_see_club(club_id) and platform.club_editable(club_id))$f$, t);
  end loop;
end $$;
