-- F02 sign-in, lane D request / migration 0022: app.club_sign_in_target(p_slug).
-- The sign-in route knows only the slug in the URL, so it asks before any club is in the context. It returns
-- zero or one row of the facts sign-in needs: the club, its status, names, default language, the LIFF id and the
-- Login channel id. The Login channel id is the audience the server checks on the ID token; it is for the
-- server only and must not go into the public config (app.public_club_config has no such column). Nothing for
-- an unknown slug. SECURITY DEFINER with a fixed search path; booq_app only.
create function app.club_sign_in_target(p_slug text)
returns table (club_id uuid, status text, name_th text, name_en text, default_language text, liff_id text, login_channel_id text)
language sql stable security definer set search_path = pg_catalog
as $$
  select c.id, c.status, c.name_th, c.name_en, c.default_language, l.liff_id, l.login_channel_id
    from public.club c
    left join public.line_connection l on l.club_id = c.id
   where c.slug = p_slug
$$;
alter function app.club_sign_in_target(text) owner to booq_owner;
revoke all on function app.club_sign_in_target(text) from public;
grant execute on function app.club_sign_in_target(text) to booq_app;
