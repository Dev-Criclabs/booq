-- F02 sign-in, decisions D102 and D103 / migration 0024: public.public_club_config.
-- The minimal sign-in config a caller who is not signed in may read, so liff.init can run. One row, the club in
-- the context, with named columns only: no owner, tax, billing or channel ids, and no club id. It is shown in
-- every status on purpose (D102: Draft and Testing clubs still serve this much; the status column lets the
-- page show the right state). The Login channel id is not here; the server gets it from app.club_sign_in_target.
-- Logo and supported languages have no columns yet: the languages are fixed (th, en) and a logo is not stored.
create view public.public_club_config with (security_barrier = true) as
select c.name_th, c.name_en, c.default_language, c.status, l.liff_id
  from public.club c
  left join public.line_connection l on l.club_id = c.id
 where c.id = app.club_id();
alter view public.public_club_config owner to booq_owner;
revoke all on public.public_club_config from public;
grant select on public.public_club_config to booq_app, booq_worker;
