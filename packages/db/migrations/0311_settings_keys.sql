-- F04-T07 / migration 0311: the F04 setting key (R5-AC1, AC4). The design numbered this 0307.
-- birthday_discount is { kind, value }: 'percent' with value in basis points (0 to 10000), or 'fixed' with value
-- in satang, the same kinds as a promo code. No club has a value until F14 sets one (no template item carries
-- it), so the birthday discount does not apply anywhere by default. The cancel window is F01's key (0041).
insert into app.setting_keys (setting_key) values ('birthday_discount');

alter table public.club_setting add constraint club_setting_birthday_discount check (
  key <> 'birthday_discount' or (
    jsonb_typeof(value) = 'object'
    and value ? 'kind' and value ? 'value' and (value - 'kind' - 'value') = '{}'::jsonb
    and jsonb_typeof(value -> 'value') = 'number'
    and (value ->> 'value') ~ '^[0-9]+$'
    and (
      (value ->> 'kind' = 'percent' and (value ->> 'value')::numeric <= 10000)
      or value ->> 'kind' = 'fixed'
    )
  )
);
