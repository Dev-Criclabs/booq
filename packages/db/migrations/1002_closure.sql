-- F09-T02 / migration 1002: closure, closure_resource and the foreign key from occupancy.closure_id.
-- F09 design 3.2; FA 3.1. Requirements: CANCEL-03-AC1, AC9, AC13, AC14.
--
--   * closure: the definition a staff member saves (courts through closure_resource, range, repeat, reason,
--     who). Any minute range; the Bangkok wall clock is entered and the instants stored. repeat_rule is null or
--     {"kind": "daily"} or {"kind": "weekly", "weekdays": [ISO 1..7, ...]}, either with an optional "until"
--     date (YYYY-MM-DD). No value of the rule is typed in code. status active, or ended with who and when.
--   * The closed slots are occupancy rows of kind closure, one per court per occurrence, whose closure_id now
--     must name a closure of the same club. They carry the exclusion constraint of 0203, so a closed range can
--     never overlap a booking or a hold. booking_cancel.closure_id (1001) gets the same foreign key.
--   * Written only by the F09 definer functions (T08a, T08b): no app role inserts, updates or deletes. Front
--     desk and owner read their club's closures (design 7); players see closed hours through public_slot_state.
--     Audited (CANCEL-03-AC14). Class D: BOOQ staff never.

create function app.valid_closure_repeat(p_rule jsonb) returns boolean
language sql immutable set search_path = pg_catalog
as $$
  -- coalesce: a missing key makes a comparison null, which a CHECK would let through.
  select p_rule is null or coalesce(
    jsonb_typeof(p_rule) = 'object'
    and (p_rule - 'kind' - 'weekdays' - 'until') = '{}'::jsonb
    and case p_rule ->> 'kind'
          when 'daily' then not (p_rule ? 'weekdays')
          when 'weekly' then case when jsonb_typeof(p_rule -> 'weekdays') = 'array'   -- CASE: AND does not promise its order
                                  then jsonb_array_length(p_rule -> 'weekdays') > 0
                                   and not exists (select 1 from jsonb_array_elements(p_rule -> 'weekdays') w
                                                    where jsonb_typeof(w) <> 'number' or w::text !~ '^[1-7]$')
                                  else false end
          else false
        end
    and (not (p_rule ? 'until') or (jsonb_typeof(p_rule -> 'until') = 'string' and (p_rule ->> 'until') ~ '^\d{4}-\d{2}-\d{2}$')),
    false)
$$;
alter function app.valid_closure_repeat(jsonb) owner to booq_owner;
revoke all on function app.valid_closure_repeat(jsonb) from public;

create table public.closure (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  reason text not null,
  range_start timestamptz not null,
  range_end timestamptz not null,
  repeat_rule jsonb,
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default app.now(),
  ended_by uuid,
  ended_at timestamptz,
  is_test boolean not null default false,
  primary key (club_id, id),
  constraint closure_reason check (btrim(reason) <> ''),
  constraint closure_range check (range_end > range_start),
  constraint closure_repeat_rule check (app.valid_closure_repeat(repeat_rule)),
  constraint closure_status check (status in ('active', 'ended')),
  constraint closure_ended_together check ((status = 'ended') = (ended_at is not null and ended_by is not null))
);
create index closure_active on public.closure (club_id) where status = 'active';

create table public.closure_resource (
  club_id uuid not null,
  closure_id uuid not null,
  resource_id uuid not null,
  is_test boolean not null default false,
  primary key (club_id, closure_id, resource_id),
  foreign key (club_id, closure_id) references public.closure (club_id, id),
  foreign key (club_id, resource_id) references public.resource (club_id, id)
);

alter table public.occupancy add constraint occupancy_closure_fk
  foreign key (club_id, closure_id) references public.closure (club_id, id);
alter table public.booking_cancel add constraint booking_cancel_closure_fk
  foreign key (club_id, closure_id) references public.closure (club_id, id);

do $$
declare t text;
begin
  foreach t in array array['closure', 'closure_resource'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
    execute format($f$create policy %1$s_staff_read on public.%1$I for select to booq_app using (app.has_any_role('owner', 'front_desk'))$f$, t);
    execute format('create policy %1$s_worker_read on public.%1$I for select to booq_worker using (true)', t);
    execute format('grant select on public.%I to booq_app, booq_worker', t);
  end loop;
end $$;

-- Purged after the occupancy rows (100) and cancel rows (190) that point at a closure.
select app.register_test_table('public.closure_resource', 192);
select app.register_test_table('public.closure', 194);
select audit.register('public.closure', array['id']);
select audit.register('public.closure_resource', array['closure_id', 'resource_id']);
