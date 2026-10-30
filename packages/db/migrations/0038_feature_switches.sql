-- F01-T25 / migration 0038: feature switches (PLAT-05-AC1 to AC6; F01 design A-1).
-- A switch belongs to one club (club_feature, tenant policies from migration 0002) and is audited by the
-- trigger registered in migration 0005. The list of switches is data: only keys the spec names exist
-- (PLAT-05-AC6). A feature that needs a payment option exists only when the club chose it (AC4).
-- The server decides: app.has_feature is what every route that declares a feature asks (route() in
-- packages/auth), so a hidden screen is never the only guard (AC2).

create table app.feature_keys (
  feature_key text primary key check (feature_key <> ''),
  -- Null: the switch applies to every club. 'slip': it exists only for a club that chose slip checking (F16).
  requires_payment_option text check (requires_payment_option in ('beam', 'slip'))
);
alter table app.feature_keys owner to booq_owner;
revoke all on app.feature_keys from public;
grant select on app.feature_keys to booq_app, booq_worker, booq_platform;

-- Design A-1: payment option is a club column (P2 step 5), not a switch; slip checking and backup mode only
-- exist with slip checking; coach add at checkout is a plain switch.
insert into app.feature_keys (feature_key, requires_payment_option) values
  ('slip_checking', 'slip'),
  ('backup_mode', 'slip'),
  ('coach_add_at_checkout', null);

alter table public.club_feature add constraint club_feature_key_fk foreign key (feature_key) references app.feature_keys (feature_key);

-- SECURITY INVOKER on purpose: it reads club_feature and club through the caller's own row policies, so it can
-- only ever see the context club, and it takes no club argument. No context, no row: off.
create function app.has_feature(p_key text) returns boolean
language sql stable set search_path = pg_catalog
as $$
  select coalesce((
    select f.enabled
      from public.club_feature f
      join app.feature_keys k on k.feature_key = f.feature_key
      join public.club c on c.id = f.club_id
     where f.club_id = app.club_id() and f.feature_key = p_key
       and (k.requires_payment_option is null or c.payment_option = k.requires_payment_option)
  ), false)
$$;
alter function app.has_feature(text) owner to booq_owner;
revoke all on function app.has_feature(text) from public;
grant execute on function app.has_feature(text) to booq_app, booq_worker;
