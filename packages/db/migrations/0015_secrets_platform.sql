-- F01-T09 follow-up / migration 0015: what BOOQ staff may do with the connections and secrets
-- (PLAT-02-AC8, D27, SR-02, SR-03), now that the platform helpers of migration 0008 exist.
--   * connections: staff read them (the masked tails included) and edit the non-secret columns,
--     by the same rule as every setup table: assigned or admin, club in Draft or Testing or the
--     owner's window open.
--   * secrets: write-only, through platform.write_secret(); never a select on the ciphertext.
--   * a staff write on a Live or Paused club leaves a notice for the owner (design 6.3).

-- The owner's notice board. Setup facts only: which kind of thing BOOQ staff changed, who, when.
-- The admin screen shows it as a banner; the LINE message to the owner is F10's (outbox).
create table public.owner_notice (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  kind text not null,
  subject text not null check (subject <> ''),
  by_staff_label text not null check (by_staff_label <> ''),
  created_at timestamptz not null default app.now(),
  seen_at timestamptz,
  seen_by uuid,
  primary key (club_id, id),
  foreign key (club_id, seen_by) references public.app_user (club_id, id),
  constraint owner_notice_kind_values check (kind in ('platform_change')),
  constraint owner_notice_seen_together check ((seen_at is null) = (seen_by is null))
);
alter table public.owner_notice owner to booq_owner;
alter table public.owner_notice enable row level security;
alter table public.owner_notice force row level security;
revoke all on public.owner_notice from public;
create policy owner_notice_tenant on public.owner_notice as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy owner_notice_definer on public.owner_notice for all to booq_owner using (true) with check (true);
create policy owner_notice_owner_read on public.owner_notice for select to booq_app using (app.has_any_role('owner'));
create policy owner_notice_owner_seen on public.owner_notice for update to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner') and seen_by = app.user_id());
create policy owner_notice_worker_read on public.owner_notice for select to booq_worker using (true);
grant select on public.owner_notice to booq_app, booq_worker;
grant update (seen_at, seen_by) on public.owner_notice to booq_app;
-- BOOQ staff never read the notices (the owner's own board). Audited: the owner marking one seen.
select audit.register('public.owner_notice', array['id']);

-- A staff write on a Live or Paused club (possible only inside the owner's window) leaves a notice.
create function app.notify_owner_of_platform_change(p_club uuid, p_subject text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_label text := coalesce(nullif(current_setting('app.actor_label', true), ''), 'BOOQ staff');
begin
  if v_staff is not null and (select c.status from public.club c where c.id = p_club) in ('live', 'paused') then
    insert into public.owner_notice (club_id, kind, subject, by_staff_label) values (p_club, 'platform_change', p_subject, v_label);
  end if;
end $$;
alter function app.notify_owner_of_platform_change(uuid, text) owner to booq_owner;
revoke all on function app.notify_owner_of_platform_change(uuid, text) from public;
-- Called from the trigger below (run as the writer) and from platform.write_secret; the function does the checks itself.
grant execute on function app.notify_owner_of_platform_change(uuid, text) to booq_platform, booq_owner;

create function app.notice_connection_change() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp
as $$
begin
  -- platform.write_secret keeps the tail in step and leaves its own, more specific notice
  if coalesce(current_setting('app.in_write_secret', true), '') <> 'on' then
    perform app.notify_owner_of_platform_change(new.club_id, tg_table_name);
  end if;
  return null;
end $$;
alter function app.notice_connection_change() owner to booq_owner;
revoke all on function app.notice_connection_change() from public;
create trigger notice_platform_change after insert or update on public.line_connection
  for each row execute function app.notice_connection_change();
create trigger notice_platform_change after insert or update on public.payment_connection
  for each row execute function app.notice_connection_change();

-- Connections: read all (masked tails included); write everything but the tails, which only
-- platform.write_secret / app.write_secret maintain.
grant select on public.line_connection, public.payment_connection to booq_platform;
grant insert (club_id, login_channel_id, messaging_channel_id, liff_id, oa_basic_id, line_plan_kind, plan_message_limit, tested_at)
  on public.line_connection to booq_platform;
grant update (login_channel_id, messaging_channel_id, liff_id, oa_basic_id, line_plan_kind, plan_message_limit, tested_at)
  on public.line_connection to booq_platform;
grant insert (club_id, merchant_id_test, merchant_id_live, webhook_token_hash_test, webhook_token_hash_live, tested_at)
  on public.payment_connection to booq_platform;
grant update (merchant_id_test, merchant_id_live, webhook_token_hash_test, webhook_token_hash_live, tested_at)
  on public.payment_connection to booq_platform;
do $$
declare t text;
begin
  foreach t in array array['line_connection', 'payment_connection'] loop
    execute format($f$create policy %1$s_platform_read on public.%1$I for select to booq_platform using (platform.can_see_club(club_id))$f$, t);
    execute format($f$create policy %1$s_platform_write on public.%1$I for all to booq_platform
                      using (platform.can_see_club(club_id) and platform.club_editable(club_id))
                      with check (platform.can_see_club(club_id) and platform.club_editable(club_id))$f$, t);
  end loop;
end $$;

-- Secrets: one function, staff only. The envelope is made in the platform app with the public key
-- (it cannot decrypt). The caller must be an active staff member who can see the club, and the club
-- must be editable (Draft, Testing, or the owner's window open). Nothing is ever selectable.
alter table public.club_secret add constraint club_secret_staff_fk foreign key (written_by_staff) references platform.platform_staff (id);

create function platform.write_secret(p_kind text, p_ciphertext text, p_key_id text, p_last4 text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := platform.staff_id();
begin
  if v_club is null then
    raise exception 'write_secret needs a club in the context' using errcode = 'P0001';
  end if;
  if v_staff is null or not exists (select 1 from platform.platform_staff s where s.id = v_staff and s.active)
     or not platform.can_see_club(v_club) then
    raise exception 'write_secret: not found' using errcode = 'P0001';   -- unassigned and missing look the same
  end if;
  if not exists (select 1 from public.club c where c.id = v_club
                  and (c.status in ('draft', 'testing') or c.allow_booq_changes_until > app.now())) then
    raise exception 'write_secret: the club is look only' using errcode = '42501';
  end if;
  if p_last4 is null or length(p_last4) > 4 then
    raise exception 'write_secret: at most four characters may be kept for display' using errcode = 'P0001';
  end if;
  perform set_config('app.in_write_secret', 'on', true);
  insert into public.club_secret as s (club_id, kind, ciphertext, key_id, written_by_staff, written_by_user, written_at)
    values (v_club, p_kind, p_ciphertext, p_key_id, v_staff, null, app.now())
    on conflict (club_id, kind) do update
      set ciphertext = excluded.ciphertext, key_id = excluded.key_id,
          written_by_staff = excluded.written_by_staff, written_by_user = null, written_at = excluded.written_at;
  if p_kind like 'line\_%' then
    insert into public.line_connection as c (club_id, secret_last4) values (v_club, jsonb_build_object(p_kind, p_last4))
      on conflict (club_id) do update set secret_last4 = c.secret_last4 || jsonb_build_object(p_kind, p_last4);
  else
    insert into public.payment_connection as c (club_id, secret_last4) values (v_club, jsonb_build_object(p_kind, p_last4))
      on conflict (club_id) do update set secret_last4 = c.secret_last4 || jsonb_build_object(p_kind, p_last4);
  end if;
  perform set_config('app.in_write_secret', 'off', true);
  perform app.notify_owner_of_platform_change(v_club, 'club_secret:' || p_kind);
end $$;
alter function platform.write_secret(text, text, text, text) owner to booq_owner;
revoke all on function platform.write_secret(text, text, text, text) from public;
grant execute on function platform.write_secret(text, text, text, text) to booq_platform;
