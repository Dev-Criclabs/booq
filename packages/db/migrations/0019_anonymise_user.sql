-- F01-T33 / migration 0019: delete a player's personal data (PDPA-01-AC5 to AC7). F01 design 7.7.
-- Review amendment D104, SR-04, SR-19; assumption A-18 (refuse while a future booking exists).
--   app.deletion_impact(user)  the counts staff see before they confirm (booq_app cannot read booking).
--   app.anonymise_user(user)   replaces the personal values, ends the person, clears every other personal
--                              store, and keeps receipts, ledgers and bookings under the same id.
-- Both are SECURITY DEFINER with a fixed search path, take the club from app.club_id(), and are for owner
-- and front desk (the data-request handlers, ROLE matrix `datarequest.handle`).

alter table public.app_user add column anonymised_at timestamptz;

-- Features that hold personal data of their own register what to do here: F10 clears message_outbox
-- parameters, F06 reports credits and wallet in the impact. Handlers take (club uuid, user uuid);
-- an impact handler returns a jsonb object that is merged into the counts.
create table app.anonymise_handlers (
  handler_key text primary key check (handler_key <> ''),
  handler regprocedure not null,
  created_at timestamptz not null default app.now()
);
create table app.deletion_impact_handlers (
  handler_key text primary key check (handler_key <> ''),
  handler regprocedure not null,
  created_at timestamptz not null default app.now()
);
alter table app.anonymise_handlers owner to booq_owner;
alter table app.deletion_impact_handlers owner to booq_owner;
revoke all on app.anonymise_handlers, app.deletion_impact_handlers from public;

create function app.deletion_impact(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_out jsonb;
  h record;
begin
  if v_club is null then
    raise exception 'deletion_impact needs a club in the context' using errcode = 'P0001';
  end if;
  if not app.has_any_role('owner', 'front_desk') then
    raise exception 'deletion_impact: not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_user) then
    raise exception 'deletion_impact: not found' using errcode = 'P0001';
  end if;
  v_out := jsonb_build_object(
    'future_bookings', (select count(*) from public.booking b
                         where b.club_id = v_club and b.customer_id = p_user and b.status = 'confirmed' and b.end_at > app.now()),
    'held_bookings', (select count(*) from public.booking b
                       where b.club_id = v_club and b.customer_id = p_user and b.status = 'awaiting_payment' and b.hold_expires_at > app.now()));
  for h in select handler from app.deletion_impact_handlers order by handler_key loop
    execute format('select $3 || %s($1, $2)', h.handler::regproc::text) into v_out using v_club, p_user, v_out;
  end loop;
  return v_out;
end $$;

create function app.anonymise_user(p_user uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  u public.app_user%rowtype;
  v_line text;
  v_phone text;
  v_name text;
  r record;
  h record;
  v_notes uuid[];
  v_note uuid;
begin
  if v_club is null then
    raise exception 'anonymise_user needs a club in the context' using errcode = 'P0001';
  end if;
  if not app.has_any_role('owner', 'front_desk') then
    raise exception 'anonymise_user: not allowed' using errcode = '42501';
  end if;
  select * into u from public.app_user where club_id = v_club and id = p_user for update;
  if not found then
    raise exception 'anonymise_user: not found' using errcode = 'P0001';
  end if;
  if u.anonymised_at is not null then
    raise exception 'anonymise_user: already done' using errcode = 'P0001';
  end if;
  -- A-18: staff cancel or finish a future booking first; the function does not decide what happens to it.
  if exists (select 1 from public.booking b
              where b.club_id = v_club and b.customer_id = p_user
                and ((b.status = 'confirmed' and b.end_at > app.now())
                     or (b.status = 'awaiting_payment' and b.hold_expires_at > app.now()))) then
    raise exception 'anonymise_user: a future booking exists' using errcode = 'P0001';
  end if;

  v_line := u.line_user_id; v_phone := u.phone_normalized; v_name := u.full_name;

  -- The person: personal values go, the row and its id stay (receipts, ledgers and bookings point at it).
  -- The LINE id becomes a value no sign in can ever present, so the same LINE user signing in later is a new player.
  update public.app_user
     set full_name = null, phone = null, phone_normalized = null, date_of_birth = null, display_name = null,
         language = null, level = null, line_friend = null, line_friend_checked_at = null,
         line_user_id = case when line_user_id is null then null else 'erased:' || id::text end,
         active = false, anonymised_at = app.now()
   where club_id = v_club and id = p_user;

  -- Every other personal store.
  -- The delete writes its own audit entry holding the note in pii_old, so erase after it.
  with gone as (
    delete from public.user_staff_note where club_id = v_club and user_id = p_user returning id
  )
  select coalesce(array_agg(id), '{}') into v_notes from gone;
  foreach v_note in array v_notes loop
    perform audit.erase_pii('user_staff_note', v_note);
  end loop;
  delete from public.auth_session where club_id = v_club and user_id = p_user;
  delete from public.idempotency_key where club_id = v_club and user_id = p_user;
  update public.club_invite set bound_line_user_id = 'erased' where club_id = v_club and bound_line_user_id = v_line and v_line is not null;
  -- Erase after each update: the update's own audit entry holds the old value.
  update public.claim_request set typed_full_name = '[erased]', typed_phone = '[erased]'
   where club_id = v_club and claimant_user_id = p_user;
  for r in select id from public.claim_request where club_id = v_club and claimant_user_id = p_user loop
    perform audit.erase_pii('claim_request', r.id);
  end loop;
  update public.data_request set note = null where club_id = v_club and user_id = p_user and note is not null;
  for r in select id from public.data_request where club_id = v_club and user_id = p_user loop
    perform audit.erase_pii('data_request', r.id);
  end loop;
  -- Import staging rows that carry this person's phone or name.
  delete from public.import_row r2
   where r2.club_id = v_club
     and ((v_phone is not null and r2.raw::text like '%' || v_phone || '%')
          or (v_name is not null and btrim(v_name) <> '' and r2.raw::text like '%' || v_name || '%'));

  -- Features with stores of their own (F10 outbox parameters ...).
  for h in select handler from app.anonymise_handlers order by handler_key loop
    execute format('select %s($1, $2)', h.handler::regproc::text) using v_club, p_user;
  end loop;

  -- The audit log keeps what happened and drops who it was about: personal values in this person's entries
  -- (including the update just made) become the placeholder, and each run is recorded in audit_erasure.
  perform audit.erase_pii('app_user', p_user);
  perform audit.note('user.anonymised', 'app_user', p_user, null, null);
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.deletion_impact(uuid)', 'app.anonymise_user(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
