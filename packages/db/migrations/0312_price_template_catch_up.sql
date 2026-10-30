-- F04-T06 follow-up / migration 0312 (the orchestrator's note on 0043): 0310 registered the F04 template
-- handlers, which predate app.catch_up_template_handler. Every migration that registers a handler must call it
-- so clubs already started from a template receive the items they were waiting for. Order matters: the groups
-- (age_band) exist before the court prices (price) that attach to them.
select app.catch_up_template_handler('age_band');
select app.catch_up_template_handler('price');
select app.catch_up_template_handler('coach_tier');
select app.catch_up_template_handler('add_on');
