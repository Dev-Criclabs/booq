-- F03-T19 / migration 0223: the worker's view of holds that have ended. F03 design 6.
-- Requirements: BOOK-03-AC5, AC6.
--
-- The hold_release job runs for all clubs, but a club-context transaction sees one club. This
-- function lets the worker (and only the worker) list, across clubs, the orders that still have
-- an awaiting_payment hour whose hold has ended, oldest first, so the job can then release each
-- order in its own club-context transaction through app.release_hold (which does the work and
-- the club check). It returns ids and a lag in seconds, nothing else.

create function app.due_hold_orders(p_limit integer default 200)
returns table (club_id uuid, order_id uuid, lag_seconds integer)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'booq_worker' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select b.club_id, b.order_id,
           greatest(0, extract(epoch from (app.now() - min(b.hold_expires_at))))::integer
      from public.booking b
     where b.status = 'awaiting_payment' and b.hold_expires_at <= app.now()
     group by b.club_id, b.order_id
     order by min(b.hold_expires_at), b.order_id
     limit greatest(1, p_limit);
end $$;
alter function app.due_hold_orders(integer) owner to booq_owner;
revoke all on function app.due_hold_orders(integer) from public;
grant execute on function app.due_hold_orders(integer) to booq_worker;
