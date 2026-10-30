-- F02-T17 follow-up / migration 0052: the webhook token hashes are write-only in the audit log. A hash of a 256 bit
-- random token cannot be turned back into the token, but it selects a club's webhook and there is no reason for it to
-- sit in the log: the entry says the column was set or changed, never the value (the same rule as club_secret, D27).
update audit.registry set secret_columns = (select array(select distinct c from unnest(secret_columns || array['webhook_token_hash']) c))
 where table_schema = 'public' and table_name = 'line_connection';
update audit.registry set secret_columns = (select array(select distinct c from unnest(secret_columns || array['webhook_token_hash_test', 'webhook_token_hash_live']) c))
 where table_schema = 'public' and table_name = 'payment_connection';
