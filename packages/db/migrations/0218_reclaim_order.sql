-- F03-T14 / migration 0218: reclaim_order for a late payment. F03 design 4.3; FA 6.6.
-- Requirements: BOOK-03-AC7, AC8. Decisions D25, D109. Assumption A-7. Review SR-07.
--
-- A player paid after the hold ended and the hold was released. If the slot is still open the
-- booking comes back confirmed; if not, slot_unavailable is raised and F05 sends the whole amount
-- to the wallet. It repeats no window, limit or hour check, because the player already paid; it
-- asks only whether the slot is free, which is exactly the exclusion constraints (no other hold,
-- booking or closure; for a solo class court and coach both free). Nothing partial is ever left:
-- the occupancy inserts and the status change are one sub-block.
--
-- Callable only on the payment path (the worker role), never by a player route. A Paused club
-- never confirms a late payment (D109); the same refusal sends the value to the wallet.

create function app.reclaim_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_status text;
  v_ids uuid[];
  v_constraint text;
  b record;
begin
  if v_club is null or coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = 'BK001';
  end if;

  select array_agg(id order by id) into v_ids
    from (select id from public.booking
           where club_id = v_club and order_id = p_order and status = 'released'
           order by id for update) x;
  if v_ids is null then return false; end if;

  select status into v_status from public.club where id = v_club;
  if v_status = 'paused' then perform app.refuse('club_paused'); end if;

  -- A hold of someone else that has ended must not block a player who has paid (FA 3.2).
  for b in select resource_id, coach_id, min(start_at) as s, max(end_at) as e
             from public.booking where club_id = v_club and id = any (v_ids) group by resource_id, coach_id loop
    perform app.release_expired_overlapping(b.resource_id, b.coach_id, b.s, b.e);
  end loop;

  begin
    insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, booking_id)
    select club_id, case when coach_id is null then 'court_booking' else 'solo_class' end, resource_id, coach_id,
           start_at, end_at, 'confirmed', id
      from public.booking where club_id = v_club and id = any (v_ids) order by start_at;
    update public.booking
       set status = 'confirmed', confirmed_at = v_now, release_reason = null, released_at = null,
           hold_expires_at = null, updated_at = v_now
     where club_id = v_club and id = any (v_ids) and status = 'released';
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception 'slot_unavailable' using errcode = 'BK001',
      detail = case when v_constraint = 'occupancy_no_overlap_coach' then 'coach' else 'resource' end;
  end;
  return true;
end $$;
alter function app.reclaim_order(uuid) owner to booq_owner;
revoke all on function app.reclaim_order(uuid) from public;
grant execute on function app.reclaim_order(uuid) to booq_app, booq_worker;
