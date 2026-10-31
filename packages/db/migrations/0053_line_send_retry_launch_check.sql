-- F01 follow-up / migration 0053: line_send_retry_set joins the required Go live checks (orchestrator, 30 Oct).
-- F10's 0610 registered the producer app.launch_line_send_retry (pending until line_send_max_attempts and line_send_retry_seconds are
-- positive platform config numbers). The list is data (0034); this adds the key once, owed by BOOQ, and leaves any admin edit alone.
update platform.config
   set value = value || jsonb_build_array(jsonb_build_object('key', 'line_send_retry_set', 'owed_by', 'booq'))
 where key = 'required_launch_checks'
   and jsonb_typeof(value) = 'array'
   and not exists (select 1 from jsonb_array_elements(value) e(r) where e.r ->> 'key' = 'line_send_retry_set');
