-- F10-T09 follow-up / migration 0610: the sender's retry values as a Go live check (orchestrator, 30 Oct).
-- line_send_max_attempts and line_send_retry_seconds (0609, assumption A-3) are platform config with no default:
-- BOOQ sets them in the console before the 7 Dec test. Until both are positive numbers the check line_send_retry_set
-- is pending; once the key is on the Go live list, P3 shows them as missing setup, like pay_tap_limit_set (0046).

create function app.launch_line_send_retry(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select (select count(*) from platform.config c
           where c.key in ('line_send_max_attempts', 'line_send_retry_seconds')
             and jsonb_typeof(c.value) = 'number' and (c.value #>> '{}')::numeric > 0) = 2
$$;
alter function app.launch_line_send_retry(uuid) owner to booq_owner;
revoke all on function app.launch_line_send_retry(uuid) from public;

select app.register_launch_producer('line_send_retry_set', 'app.launch_line_send_retry(uuid)'::regprocedure, 'F10-T09 platform config');

-- Not added to required_launch_checks here: the list is data an admin keeps (0034, platform.set_config_value), and
-- the platform lane's Go live tests pin it. Adding the key to the list is theirs or the admin's (orchestrator asked).
