-- F06-T26 / migration 0517: the 'product' template handler (PKG-02-AC1; decision D166).
-- The Tennis template (0039) lists Hunter's products as 'product' items, but nothing loaded them. Rules of D166:
--   court_hours, a bundle of hours     -> package_product credit_type court_hour, no price group
--   group_class with quantity above 1  -> group_session, the price group the template made from that age_band (audience)
--   solo_class packs                   -> skipped: a solo pack is sold per coach tier (PRD) and the template has no tier.
--                                         The owner creates them per tier in A9. app.solo_packs_done below tells the
--                                         A0 dashboard (F11) to show a reminder; it does not block any status move,
--                                         which the PRD does not ask for (orchestrator, 31 Oct). No tier is invented.
--   single sessions (quantity 1)       -> skipped: not packages; those prices belong to F07 tiers and F08 drop-in
-- Prices and validity are the template's values, never typed here. Names are copied, as for every template item, from
-- the template data, which holds the writers' text of the key named in name_key with its variables filled: P-0186
-- "{hours} hour bundle" and P-0227 "Group {sessions} session pack" (a test keeps it equal to the language files). The
-- owner can edit the names afterwards. apply_template runs kinds in name order, so age_band (the price groups) and
-- coach_tier run before product.

-- The names of the four products the handler loads, as template data (the writers own the wording).
update platform.template_item i
   set value = i.value || jsonb_build_object('name_key', 'P-0186', 'name_en', '10 hour bundle', 'name_th', 'แพ็กเกจ 10 ชั่วโมง')
  from platform.template t where t.id = i.template_id and t.key = 'tennis' and i.kind = 'product' and i.key = 'bundle_10h';
update platform.template_item i
   set value = i.value || jsonb_build_object('name_key', 'P-0186', 'name_en', '20 hour bundle', 'name_th', 'แพ็กเกจ 20 ชั่วโมง')
  from platform.template t where t.id = i.template_id and t.key = 'tennis' and i.kind = 'product' and i.key = 'bundle_20h';
update platform.template_item i
   set value = i.value || jsonb_build_object('name_key', 'P-0227', 'name_en', 'Group 8 session pack', 'name_th', 'แพ็กคลาสกลุ่ม 8 ครั้ง')
  from platform.template t where t.id = i.template_id and t.key = 'tennis' and i.kind = 'product' and i.key in ('group_pack8_adult', 'group_pack8_student');

create function app.template_product(p_club uuid, p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_type text := p_value ->> 'type';
  v_quantity integer := (p_value ->> 'quantity')::integer;
  v_credit_type text;
  v_group uuid;
begin
  if p_club is distinct from app.club_id() then raise exception 'template:club_context' using errcode = 'P0001'; end if;
  if v_type not in ('court_hours', 'group_class', 'solo_class') then
    raise exception 'template:product:unknown_type:%', p_key using errcode = 'P0001';
  end if;
  -- Skipped by D166: solo packs (no tier) and single sessions (not packages).
  if v_type = 'solo_class' or coalesce(v_quantity, 0) <= 1 then
    return;
  end if;
  v_credit_type := case v_type when 'court_hours' then 'court_hour' else 'group_session' end;
  if v_type = 'group_class' then
    -- The audience is the key of an age_band item of the template this product comes from (club.template_id is
    -- written after the items run); its group is the club's price group of that name, made by the age_band handler.
    select g.id into v_group
      from platform.template_item a
      join public.price_group g on g.club_id = p_club and g.name_en = a.value ->> 'name_en'
     where a.kind = 'age_band' and a.key = p_value ->> 'audience'
       and a.template_id in (select i.template_id from platform.template_item i where i.kind = 'product' and i.key = p_key)
     order by g.position, g.id
     limit 1;
    if v_group is null then
      raise exception 'template:product:no_price_group:%', p_key using errcode = 'P0001';
    end if;
  end if;
  insert into public.package_product (club_id, name_th, name_en, credit_type, credits, validity_months, price_group_id, price_satang)
    values (p_club, p_value ->> 'name_th', p_value ->> 'name_en', v_credit_type, v_quantity,
            (p_value ->> 'validity_months')::integer, v_group, (p_value ->> 'price_satang')::integer);
end $$;
alter function app.template_product(uuid, text, jsonb) owner to booq_owner;
revoke all on function app.template_product(uuid, text, jsonb) from public;

-- For the owner's non-blocking reminder on A0 (F11): true when every coach tier of the club has an active solo pack.
-- A club with no coach tier has nothing to do. Not a setup step: it gates nothing.
create function app.solo_packs_done(p_club uuid) returns boolean
language sql stable security definer set search_path = pg_catalog
as $$
  select not exists (
    select 1 from public.coach_tier t
     where t.club_id = p_club
       and not exists (select 1 from public.package_product p
                        where p.club_id = t.club_id and p.coach_tier_id = t.id and p.credit_type = 'solo_class' and p.active))
$$;
alter function app.solo_packs_done(uuid) owner to booq_owner;
revoke all on function app.solo_packs_done(uuid) from public;

select app.register_template_handler('product', 'app.template_product(uuid, text, jsonb)'::regprocedure);
select app.catch_up_template_handler('product');
