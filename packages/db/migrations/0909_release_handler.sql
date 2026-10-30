-- F08-T07 / migration 0909: the two handlers that keep the waitlist moving (CLASS-01-AC13, CLASS-02-AC2, AC14; WAIT-01-AC2). F08 design 4.10, 4.13.
--   app.f08_release(order, reason)  registered in app.release_handlers at ord 50 (F04 10, F05 20, F06 30, F07 35, F08 50, F10 60).
--       Runs inside release_hold for the order's released bookings. A held booking that was an open offer ends the offer (the
--       entry expires, the pending offer message is voided); then, unless the reason is closed (nothing to offer) or offer_ended
--       (the decline, expiry and pass on functions advance themselves), the freed class seat or court hour is offered to the next
--       in line through app.waitlist_advance. A session that is cancelled offers nothing (advance checks it).
--   app.f08_cancel(club, booking, kind)  registered in F09's app.cancel_handlers at ord 30 (by 1090, see the end of this file). A cancelled class seat or court booking
--       (player_cancel, staff_cancel, club_cancel) frees its spot and the next in line is offered it in the same transaction.
--       A closure ends the waiting entries of the closed court hour (closure) and tells them; marks and reversals change nothing here.
-- Both are idempotent: the entry status guards the ending of an offer, and advance only offers a free spot to a waiting entry.

create function app.f08_after_free(p_booking public.booking) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if p_booking.type = 'class_seat' and p_booking.class_session_id is not null then
    if exists (select 1 from public.waitlist_entry w where w.club_id = p_booking.club_id and w.class_session_id = p_booking.class_session_id and w.status = 'waiting') then
      perform app.waitlist_advance(p_booking.class_session_id, null, null);
    end if;
  elsif p_booking.type = 'court' then
    if exists (select 1 from public.waitlist_entry w where w.club_id = p_booking.club_id and w.resource_id = p_booking.resource_id and w.slot_start_at = p_booking.start_at and w.status = 'waiting') then
      perform app.waitlist_advance(null, p_booking.resource_id, p_booking.start_at);
    end if;
  end if;
end $$;
alter function app.f08_after_free(public.booking) owner to booq_owner;
revoke all on function app.f08_after_free(public.booking) from public;

create function app.f08_release(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  b public.booking%rowtype;
begin
  if v_club is null then
    raise exception 'f08_release needs a club in the context' using errcode = '42501';
  end if;
  for b in select * from public.booking where club_id = v_club and order_id = p_order and status = 'released' order by id loop
    if b.waitlist_entry_id is not null then
      -- A held seat or hour that was an open offer: the offer is over (unless the decline or the pass on already ended it).
      update public.waitlist_entry set status = 'expired' where club_id = v_club and id = b.waitlist_entry_id and status = 'offered' and offer_booking_id = b.id;
      if found then
        update public.message_outbox set status = 'void', void_reason = 'cancelled'
         where club_id = v_club and status = 'pending' and left(dedupe_key, length('offer:' || b.waitlist_entry_id::text || ':')) = 'offer:' || b.waitlist_entry_id::text || ':';
      end if;
    end if;
    if p_reason in ('closed', 'offer_ended') then
      continue;
    end if;
    perform app.f08_after_free(b);
  end loop;
end $$;
alter function app.f08_release(uuid, text) owner to booq_owner;
revoke all on function app.f08_release(uuid, text) from public;

create function app.f08_cancel(p_club uuid, p_booking uuid, p_kind text) returns void
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
  if p_kind in ('player_cancel', 'staff_cancel', 'club_cancel') and b.status in ('cancelled', 'late_cancelled') then
    perform app.f08_after_free(b);
  elsif p_kind = 'closure' and b.type = 'court' then
    for e in select id, customer_id from public.waitlist_entry
              where club_id = p_club and resource_id = b.resource_id and slot_start_at = b.start_at and status in ('waiting', 'offered') order by id for update loop
      update public.waitlist_entry set status = 'ended', ended_reason = 'closure' where club_id = p_club and id = e.id;
      perform app.coach_message_hook('waitlist_ended', e.customer_id, jsonb_build_object('entry_id', e.id), 'waitlist_ended:' || e.id);
    end loop;
  end if;
end $$;
alter function app.f08_cancel(uuid, uuid, text) owner to booq_owner;
revoke all on function app.f08_cancel(uuid, uuid, text) from public;

select app.register_release_handler('f08_waitlist', 'app.f08_release(uuid, text)'::regprocedure::regproc, 50);
-- The registration in F09's app.cancel_handlers is 1090_f08_cancel_registration.sql: that registry is created by 1003, which
-- is numbered above this file, so the registration has to come after it (build plan, section 4, late file).
