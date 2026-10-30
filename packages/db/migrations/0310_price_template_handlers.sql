-- F04-T06 / migration 0310: template handlers for price groups, court prices, coach tiers and add-ons
-- (R3-AC7, PLAT-05-AC7, AC12). The design numbered this 0305; 0305 to 0309 are taken and numbers only rise.
-- Handlers register on F01's registry (app.register_template_handler, migration 0039) and take
-- (club uuid, item key text, item value jsonb). apply_template runs items by kind then key, so the kinds
-- below are named to sort before 'price': add_on, age_band, coach_tier, then price.
--   age_band  -> price_group   {name_th, name_en, rule: {min_age, max_age}, position}
--   price           -> court_price_rule for every group of the club, 'court_hour' only: {price_satang}
--   coach_tier      -> coach_tier and its prices {name_th, name_en, prices: {<group name_en>: satang | null}}
--   add_on          -> add_on {name_th, name_en, price_satang | null, position}
-- A malformed item raises and rolls the whole apply back; nothing is dropped silently.

do $$
declare t text;
begin
  foreach t in array array['price_group', 'court_price_rule', 'coach_tier', 'coach_tier_price', 'add_on'] loop
    execute format('create policy %1$s_owner_role_insert on public.%1$I for insert to booq_owner with check (club_id = app.club_id())', t);
  end loop;
end $$;

create function app.template_age_band(p_club uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if p_club is distinct from app.club_id() then raise exception 'template:club_context' using errcode = 'P0001'; end if;
  insert into public.price_group (club_id, name_th, name_en, rule, position)
    values (p_club, p_value ->> 'name_th', p_value ->> 'name_en', p_value -> 'rule', coalesce((p_value ->> 'position')::int, 0));
end $$;

create function app.template_court_price(p_club uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare n integer;
begin
  if p_club is distinct from app.club_id() then raise exception 'template:club_context' using errcode = 'P0001'; end if;
  if p_key <> 'court_hour' then raise exception 'template:price:unknown_key:%', p_key using errcode = 'P0001'; end if;
  insert into public.court_price_rule (club_id, price_group_id, day_type, peak, price_satang)
    select g.club_id, g.id, 'any', 'any', (p_value ->> 'price_satang')::int from public.price_group g where g.club_id = p_club;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'template:price:no_groups' using errcode = 'P0001'; end if;
end $$;

create function app.template_coach_tier(p_club uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare v_tier uuid; g record;
begin
  if p_club is distinct from app.club_id() then raise exception 'template:club_context' using errcode = 'P0001'; end if;
  insert into public.coach_tier (club_id, name_th, name_en) values (p_club, p_value ->> 'name_th', p_value ->> 'name_en') returning id into v_tier;
  for g in select id, name_en from public.price_group where club_id = p_club loop
    insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang)
      values (p_club, v_tier, g.id, (p_value -> 'prices' ->> g.name_en)::int);   -- a group the item does not name stays null: not set
  end loop;
end $$;

create function app.template_add_on(p_club uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if p_club is distinct from app.club_id() then raise exception 'template:club_context' using errcode = 'P0001'; end if;
  insert into public.add_on (club_id, name_th, name_en, price_satang, position)
    values (p_club, p_value ->> 'name_th', p_value ->> 'name_en', (p_value ->> 'price_satang')::int, coalesce((p_value ->> 'position')::int, 0));
end $$;

do $$
declare f text;
begin
  foreach f in array array['app.template_age_band(uuid, text, jsonb)', 'app.template_court_price(uuid, text, jsonb)',
                           'app.template_coach_tier(uuid, text, jsonb)', 'app.template_add_on(uuid, text, jsonb)'] loop
    execute format('alter function %s owner to booq_owner', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

select app.register_template_handler('age_band', 'app.template_age_band(uuid, text, jsonb)'::regprocedure);
select app.register_template_handler('price', 'app.template_court_price(uuid, text, jsonb)'::regprocedure);
select app.register_template_handler('coach_tier', 'app.template_coach_tier(uuid, text, jsonb)'::regprocedure);
select app.register_template_handler('add_on', 'app.template_add_on(uuid, text, jsonb)'::regprocedure);

-- Hunter's data in the Tennis template. Groups: "Hunter uses Adult and Student", Adult is 18 or older,
-- Student under 18 (PRD). Names are the writers' A-0069 and A-0070. The balls add-on names are the PRD
-- strings (R3-AC7); its price is TBD in the PRD, so null. No coach tier is seeded: the PRD names tiers only
-- as examples, so the club adds its own.
insert into platform.template_item (template_id, kind, key, value)
select t.id, i.kind, i.key, i.value::jsonb
  from platform.template t
  join (values
    ('age_band', 'adult', '{"name_en": "Adult", "name_th": "ผู้ใหญ่", "rule": {"min_age": 18}, "position": 0}'),
    ('age_band', 'student', '{"name_en": "Student", "name_th": "นักเรียน", "rule": {"max_age": 17}, "position": 1}'),
    ('add_on', 'balls', '{"name_en": "Balls (Set of 3 balls)", "name_th": "ลูกเทนนิส (ชุด 3 ลูก)", "price_satang": null, "position": 0}')
  ) as i (kind, key, value) on true
 where t.key = 'tennis';
