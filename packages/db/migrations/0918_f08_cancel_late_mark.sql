-- F08 / migration 0918: a staff late cancel mark on a future slot offers the spot to the waitlist (F09 design 4.5; orchestrator note
-- from F09-T07). app.f08_cancel (0909) frees the spot only for player_cancel, staff_cancel and club_cancel. A late_cancel_mark on a
-- booking that is now late_cancelled and whose slot has not started frees it too (mark_late_cancel deletes the occupancy row in that
-- case); a mark on a started slot frees nothing, and a no_show_mark or a reversal never does. Redefines the function of 0909, so it is
-- numbered above it (D159); the registration of 1090 names the function, not the body, and stays.
create or replace function app.f08_cancel(p_club uuid, p_booking uuid, p_kind text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  b public.booking%rowtype;
  e record;
begin
  if p_club is distinct from app.club_id() then
    raise exception 'f08_cancel: wrong club' using errcode = '42501';
  end if;
  select * into b from public.booking where club_id = p_club and id = p_booking;
  if not found then return; end if;
  if (p_kind in ('player_cancel', 'staff_cancel', 'club_cancel') and b.status in ('cancelled', 'late_cancelled'))
     or (p_kind = 'late_cancel_mark' and b.status = 'late_cancelled' and b.start_at > app.now()) then
    perform app.f08_after_free(b);
  elsif p_kind = 'closure' and b.type = 'court' then
    for e in select id, customer_id from public.waitlist_entry
              where club_id = p_club and resource_id = b.resource_id and slot_start_at = b.start_at and status in ('waiting', 'offered') order by id for update loop
      update public.waitlist_entry set status = 'ended', ended_reason = 'closure' where club_id = p_club and id = e.id;
      perform app.coach_message_hook('waitlist_ended', e.customer_id, jsonb_build_object('entry_id', e.id), 'waitlist_ended:' || e.id);
    end loop;
  end if;
end $$;
