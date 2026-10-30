-- F08-T05a fix / migration 0912: generate_sessions takes the locks of FA 3.4 (rule D159; BOOK-04-AC1, AC12).
-- Redefines app.generate_sessions of 0905. Every coach of an active template is locked first, in id order (step 1); the sessions
-- are then made in court order, and the court lock app.lock_resource (0229, step 3c) is taken immediately before each occupancy
-- insert, after the session row (step 3). A transaction that holds a court lock takes no further lock, so the coaches are locked
-- before any court. Nothing else changes.

create or replace function app.generate_sessions(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_worker boolean := coalesce(current_setting('role', true), '') = 'booq_worker';
  t public.class_template%rowtype;
  d record;
  v_coach uuid;
  v_problem text;
  v_id uuid;
  v_n integer := 0;
begin
  if v_club is null or not (v_worker or app.has_any_role('owner', 'front_desk')) then
    raise exception 'template: not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'template: invalid range' using errcode = 'P0001';
  end if;
  -- Lock order (FA 3.4): every coach first, in id order; then the sessions in court order, each court lock last before its write.
  for v_coach in select distinct c.coach_id from public.class_template c where c.club_id = v_club and c.active order by c.coach_id loop
    perform app.lock_coach(v_coach);
  end loop;
  for d in
    select c.id as tid, x.day, x.start_at
      from public.class_template c
      cross join lateral app.class_dates(c.weekday, c.start_time, p_from, p_to) x
     where c.club_id = v_club and c.active and x.start_at > app.now() and (c.ended_on is null or x.day <= c.ended_on)
       and not exists (select 1 from public.class_session s where s.club_id = v_club and s.template_id = c.id and s.start_at = x.start_at)
     order by c.resource_id, x.start_at, c.id
  loop
    select * into t from public.class_template where club_id = v_club and id = d.tid;
    v_problem := app.class_hour_problem(t.coach_id, t.resource_id, d.start_at, null);
    insert into public.class_session (club_id, template_id, start_at, end_at, name_th, name_en, audience, level, coach_id, resource_id,
                                      min_players, max_players, drop_in_price_satang, status, attention_reason)
    values (v_club, t.id, d.start_at, d.start_at + interval '1 hour', t.name_th, t.name_en, t.audience, t.level, t.coach_id, t.resource_id,
            t.min_players, t.max_players, t.drop_in_price_satang, case when v_problem is null then 'scheduled' else 'needs_attention' end, v_problem)
    returning id into v_id;
    if v_problem is null then
      begin
        perform app.lock_resource(t.resource_id);                  -- step 3c: the court lock, last before the occupancy write
        insert into public.occupancy (club_id, kind, resource_id, coach_id, start_at, end_at, state, class_session_id)
        values (v_club, 'group_class', t.resource_id, t.coach_id, d.start_at, d.start_at + interval '1 hour', 'confirmed', v_id);
      exception when exclusion_violation then
        -- A claim won the hour between the check and the insert: the session is flagged, not lost.
        update public.class_session set status = 'needs_attention',
               attention_reason = case when exists (select 1 from public.occupancy o where o.club_id = v_club and o.resource_id = t.resource_id
                                                      and o.start_at < d.start_at + interval '1 hour' and o.end_at > d.start_at) then 'court_clash' else 'coach_clash' end
         where club_id = v_club and id = v_id;
      end;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
alter function app.generate_sessions(date, date) owner to booq_owner;
revoke all on function app.generate_sessions(date, date) from public;
grant execute on function app.generate_sessions(date, date) to booq_app, booq_worker;
