-- F08-T11 / migration 0915: an offer whose message could not be sent passes to the next in line (CLASS-02-AC9; LINE-07-AC6). F08 design 4.10.
-- F10's sender marks a waitlist_offer message undeliverable when the club is at its message cap on the free plan. This function
-- names, across clubs and for the worker only, the offers whose message is undeliverable while the entry still holds the offer;
-- the offer_expiry tick then calls app.waitlist_pass_on for each in the club's own context. Nothing in F10's sender changes, and
-- the message row stays as the evidence. A second run finds nothing: the pass on ends the offer.

create function app.due_undeliverable_offers(p_limit integer default 200) returns table (club_id uuid, entry_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select w.club_id, w.id
      from public.waitlist_entry w
      join public.message_outbox m on m.club_id = w.club_id and m.kind = 'waitlist_offer' and m.status = 'undeliverable'
                                  and m.dedupe_key = 'offer:' || w.id::text || ':' || w.offer_no::text
     where w.status = 'offered'
     order by w.offered_at, w.id
     limit greatest(1, p_limit);
end $$;
alter function app.due_undeliverable_offers(integer) owner to booq_owner;
revoke all on function app.due_undeliverable_offers(integer) from public;
grant execute on function app.due_undeliverable_offers(integer) to booq_worker;
