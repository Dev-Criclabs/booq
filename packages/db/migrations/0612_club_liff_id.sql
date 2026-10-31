-- F10 / migration 0612: the club's LIFF id for the sender's message buttons. F10 design 5.6 (View booking and Add to
-- calendar open the club's own LIFF app, D6); F02's deep link helper builds the link from it.
--   app.club_liff_id()  the LIFF id of the club in the context, or null. The worker reads nothing else of
--                       line_connection (it holds the masked secret tails and the plan; the worker needs only this id).

create function app.club_liff_id() returns text
language sql stable security definer set search_path = pg_catalog, pg_temp
as $$ select c.liff_id from public.line_connection c where c.club_id = app.club_id() $$;
alter function app.club_liff_id() owner to booq_owner;
revoke all on function app.club_liff_id() from public;
grant execute on function app.club_liff_id() to booq_worker;
