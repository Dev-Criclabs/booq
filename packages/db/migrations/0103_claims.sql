-- F02-T09b and the database side of F01-T31b / migration 0103: imported players are claimed,
-- never matched silently (decision D105, review SR-05). Requirements: AUTH-02-AC28, PLAT-06-AC7.
-- F02 design 4.3 step 3 and F01 design 7.4.
--
-- An imported player is an app_user with no LINE id and claim_state 'unclaimed': nobody can sign
-- in as them, they are invisible to every other player, and anything imported for them is inert.
-- When a new player types a phone that matches exactly one such record, a claim_request is made
-- and the person carries on as a new player who is told nothing. Front desk or owner confirm or
-- reject at the counter. Confirming merges the record into the claimant and runs the handlers
-- registered by later features (F06 registers the ledger transfer: a paired out and in row of
-- reason import_transfer), all in one transaction.

alter table public.app_user
  add column claim_state text,                 -- null for an ordinary person; 'unclaimed' for an import; 'merged' after a claim
  add column merged_into uuid,
  add constraint app_user_claim_state_values check (claim_state in ('unclaimed', 'merged')),
  add constraint app_user_line_or_imported check (line_user_id is not null or claim_state is not null),
  add constraint app_user_unclaimed_has_no_line check (claim_state is distinct from 'unclaimed' or line_user_id is null),
  add constraint app_user_merged_has_target check ((claim_state = 'merged') = (merged_into is not null)),
  add foreign key (club_id, merged_into) references public.app_user (club_id, id);
create index app_user_unclaimed_phone on public.app_user (club_id, phone_normalized) where claim_state = 'unclaimed';

create table public.claim_request (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  imported_user_id uuid not null,
  claimant_user_id uuid not null,
  typed_full_name text not null check (btrim(typed_full_name) <> ''),
  typed_phone text not null check (typed_phone <> ''),
  status text not null default 'open',
  requested_at timestamptz not null default app.now(),
  handled_by uuid,
  handled_at timestamptz,
  primary key (club_id, id),
  foreign key (club_id, imported_user_id) references public.app_user (club_id, id),
  foreign key (club_id, claimant_user_id) references public.app_user (club_id, id),
  foreign key (club_id, handled_by) references public.app_user (club_id, id),
  constraint claim_request_status_values check (status in ('open', 'confirmed', 'rejected')),
  constraint claim_request_handled_together check ((status = 'open') = (handled_by is null and handled_at is null)),
  constraint claim_request_distinct check (imported_user_id <> claimant_user_id)
);
-- One open request per claimant and record; a rival claimant gets their own row.
create unique index claim_request_open_pair on public.claim_request (club_id, imported_user_id, claimant_user_id) where status = 'open';

alter table public.claim_request owner to booq_owner;
alter table public.claim_request enable row level security;
alter table public.claim_request force row level security;
revoke all on public.claim_request from public;
create policy claim_request_tenant on public.claim_request as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy claim_request_definer on public.claim_request for all to booq_owner using (true) with check (true);
-- Staff list them (A6). Nobody else reads them, the claimant included: C2 never says a record was found.
create policy claim_request_staff_read on public.claim_request for select to booq_app using (app.has_any_role('owner', 'front_desk'));
grant select on public.claim_request to booq_app;

select audit.register('public.claim_request', array['id'], 'club_id', array['typed_full_name', 'typed_phone']);

-- What later features do when a claim is confirmed (F06: move the imported credits and wallet
-- movements to the claimant with paired append-only rows). Handler: (club, imported, claimant).
create table app.claim_handlers (
  handler_key text primary key check (handler_key <> ''),
  handler regprocedure not null,
  created_at timestamptz not null default app.now()
);
alter table app.claim_handlers owner to booq_owner;
revoke all on app.claim_handlers from public;

-- New player's profile transaction. Matching is on the normalised phone, among unclaimed
-- imports of this club only, and only an exact single match makes a request. Returns nothing, so
-- the caller cannot tell whether a record was found.
create function app.request_claim(p_claimant uuid, p_full_name text, p_phone text, p_phone_normalized text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_matches uuid[];
begin
  if v_club is null then
    raise exception 'request_claim needs a club in the context' using errcode = 'P0001';
  end if;
  if p_claimant is distinct from app.user_id()
     or not exists (select 1 from public.app_user u
                     where u.club_id = v_club and u.id = p_claimant and u.active and u.claim_state is null and u.line_user_id is not null) then
    raise exception 'request_claim: the claimant must be the signed-in, active, ordinary player' using errcode = 'P0001';
  end if;
  if p_phone_normalized is null or p_phone_normalized = '' then
    return;
  end if;
  select array_agg(u.id) into v_matches
    from public.app_user u
   where u.club_id = v_club and u.claim_state = 'unclaimed' and u.phone_normalized = p_phone_normalized;
  if cardinality(coalesce(v_matches, '{}')) = 1 then
    insert into public.claim_request (club_id, imported_user_id, claimant_user_id, typed_full_name, typed_phone)
    values (v_club, v_matches[1], p_claimant, p_full_name, p_phone)
    on conflict (club_id, imported_user_id, claimant_user_id) where status = 'open' do nothing;
  end if;
end $$;

-- Staff confirm that the person at the counter is the imported record. Merges, closes the
-- request, rejects rival requests for the same record, runs the handlers, in this transaction.
create function app.claim_confirm(p_imported uuid, p_claimant uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := app.user_id();
  h record;
begin
  if v_club is null then
    raise exception 'claim_confirm needs a club in the context' using errcode = 'P0001';
  end if;
  if v_staff is null or not app.has_any_role('owner', 'front_desk') or v_staff = p_claimant then
    raise exception 'claim_confirm: not allowed' using errcode = '42501';
  end if;
  update public.claim_request
     set status = 'confirmed', handled_by = v_staff, handled_at = app.now()
   where club_id = v_club and imported_user_id = p_imported and claimant_user_id = p_claimant and status = 'open';
  if not found then
    raise exception 'claim_confirm: no open request for that record and person' using errcode = 'P0001';
  end if;
  update public.claim_request
     set status = 'rejected', handled_by = v_staff, handled_at = app.now()
   where club_id = v_club and imported_user_id = p_imported and status = 'open';
  update public.app_user
     set claim_state = 'merged', merged_into = p_claimant, active = false
   where club_id = v_club and id = p_imported and claim_state = 'unclaimed';
  if not found then
    raise exception 'claim_confirm: the record is not unclaimed' using errcode = 'P0001';
  end if;
  for h in select handler from app.claim_handlers order by handler_key loop
    execute format('select %s($1, $2, $3)', h.handler::regproc::text) using v_club, p_imported, p_claimant;
  end loop;
end $$;

create function app.claim_reject(p_request uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := app.user_id();
begin
  if v_club is null then
    raise exception 'claim_reject needs a club in the context' using errcode = 'P0001';
  end if;
  if v_staff is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'claim_reject: not allowed' using errcode = '42501';
  end if;
  update public.claim_request set status = 'rejected', handled_by = v_staff, handled_at = app.now()
   where club_id = v_club and id = p_request and status = 'open' and claimant_user_id <> v_staff;
  if not found then
    raise exception 'claim_reject: no open request' using errcode = 'P0001';
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.request_claim(uuid, text, text, text)', 'app.claim_confirm(uuid, uuid)', 'app.claim_reject(uuid)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to booq_app', f);
  end loop;
end $$;
