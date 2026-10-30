-- F02-T17 / migration 0049: which club a LINE webhook call belongs to (F02 design 5.4; LINE-01-AC6 to AC9; D149).
-- The webhook URL carries a long random token per club, shown once to BOOQ staff and kept only as a hash, as the Beam
-- tokens are (0012). The token only selects the club; the call is believed only if x-line-signature verifies with the
-- club's channel secret. Setting the token is BOOQ staff's, in the support view (the same column grant as the Beam tokens).
-- Gap in the spec, default taken (D147): design 5.4 says "club by token" but names no column; this is it.
alter table public.line_connection add column webhook_token_hash text;
create unique index line_connection_webhook_token on public.line_connection (webhook_token_hash) where webhook_token_hash is not null;
alter table public.line_connection add constraint line_webhook_token_is_hash check (webhook_token_hash is null or webhook_token_hash ~ '^[0-9a-f]{64}$');

grant insert (webhook_token_hash) on public.line_connection to booq_platform;
grant update (webhook_token_hash) on public.line_connection to booq_platform;

-- The one lookup that runs before any club is known. It answers a club id or nothing, and nothing else.
create function app.club_by_line_webhook(p_token_hash text) returns uuid
language sql stable security definer set search_path = pg_catalog
as $$ select l.club_id from public.line_connection l where l.webhook_token_hash = p_token_hash $$;
alter function app.club_by_line_webhook(text) owner to booq_owner;
revoke all on function app.club_by_line_webhook(text) from public;
grant execute on function app.club_by_line_webhook(text) to booq_app;
