-- F01-T24 follow-up / migration 0043: review of 0039, gaps 1 and 2.
--   Gap 1: a template item whose kind had no handler when the club started (products and prices wait for F04 and
--          F06) was reported as pending but never applied later. The copies are now recorded per club, so a
--          catch-up copies exactly what is missing, once: app.apply_pending_template_items() for one club (its staff
--          or its owner), and app.catch_up_template_handler(kind) for the migration that registers a handler, which
--          reaches every club already started from a template. A kind with no handler stays pending.
--   Gap 2: applying a template as BOOQ staff writes the P6 entry (with the staff name) here, not only the club's
--          audit note; the platform service no longer writes it a second time.

create table public.club_template_copy (
  club_id uuid not null references public.club (id),
  kind text not null check (kind <> ''),
  key text not null check (key <> ''),
  copied_at timestamptz not null default app.now(),
  primary key (club_id, kind, key)
);
alter table public.club_template_copy owner to booq_owner;
alter table public.club_template_copy enable row level security;
alter table public.club_template_copy force row level security;
revoke all on public.club_template_copy from public;
create policy club_template_copy_tenant on public.club_template_copy as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy club_template_copy_definer on public.club_template_copy for all to booq_owner using (true) with check (true);

-- Copies the club's template items of handled kinds that have not been copied yet. No permission check: the callers do it.
create function app.copy_pending_template_items(p_club uuid, p_kind text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_template uuid;
  v_copied jsonb := '{}'::jsonb;
  v_pending text[] := array[]::text[];
  v_handler regprocedure;
  v_prev text := current_setting('app.club_id', true);
  r record;
begin
  select c.template_id into v_template from public.club c where c.id = p_club and c.template_applied_at is not null;
  if v_template is null then
    return jsonb_build_object('copied', v_copied, 'pending', to_jsonb(v_pending));
  end if;
  -- Handlers may read the club from the context; set it for this club and put it back after.
  perform set_config('app.club_id', p_club::text, true);
  for r in select i.kind, i.key, i.value from platform.template_item i
            where i.template_id = v_template and i.kind not in ('setting', 'opening_hours', 'label')
              and (p_kind is null or i.kind = p_kind)
              and not exists (select 1 from public.club_template_copy k where k.club_id = p_club and k.kind = i.kind and k.key = i.key)
            order by i.kind, i.key loop
    select h.handler into v_handler from app.template_handlers h where h.kind = r.kind;
    if v_handler is null then
      if not (r.kind = any (v_pending)) then v_pending := v_pending || r.kind; end if;
    else
      execute format('select %s($1, $2, $3)', v_handler::regproc::text) using p_club, r.key, r.value;
      insert into public.club_template_copy (club_id, kind, key) values (p_club, r.kind, r.key);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    end if;
  end loop;
  perform set_config('app.club_id', coalesce(v_prev, ''), true);
  return jsonb_build_object('copied', v_copied, 'pending', to_jsonb(v_pending));
end $$;
alter function app.copy_pending_template_items(uuid, text) owner to booq_owner;
revoke all on function app.copy_pending_template_items(uuid, text) from public;

-- The club's own catch-up: BOOQ staff who can see the club, or the club owner.
create function app.apply_pending_template_items() returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
begin
  if v_club is null then
    raise exception 'template:no_club_context' using errcode = 'P0001';
  end if;
  if v_staff is not null then
    if not exists (select 1 from platform.platform_staff s where s.id = v_staff and s.active) or not platform.can_see_club(v_club)
       or not exists (select 1 from public.club c where c.id = v_club) then
      raise exception 'template:not_found' using errcode = 'P0001';
    end if;
  elsif not app.has_any_role('owner') then
    raise exception 'template:not_allowed' using errcode = 'P0001';
  end if;
  return app.copy_pending_template_items(v_club, null);
end $$;
alter function app.apply_pending_template_items() owner to booq_owner;
revoke all on function app.apply_pending_template_items() from public;
grant execute on function app.apply_pending_template_items() to booq_platform, booq_app;

-- For the migration that registers a handler: every club already started from a template gets that kind's missing items.
-- Returns the number of items copied. Executable by the owner role only.
create function app.catch_up_template_handler(p_kind text) returns integer
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_total integer := 0;
  c record;
  r jsonb;
begin
  for c in select id from public.club where template_applied_at is not null order by id loop
    r := app.copy_pending_template_items(c.id, p_kind);
    v_total := v_total + coalesce((r -> 'copied' ->> p_kind)::integer, 0);
  end loop;
  return v_total;
end $$;
alter function app.catch_up_template_handler(text) owner to booq_owner;
revoke all on function app.catch_up_template_handler(text) from public;

-- apply_template: record what was copied through handlers, and write the P6 entry on the staff path.
create or replace function app.apply_template(p_template uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_staff uuid := nullif(current_setting('app.actor_platform_staff_id', true), '')::uuid;
  v_t platform.template%rowtype;
  v_c public.club%rowtype;
  v_copied jsonb := '{}'::jsonb;
  v_pending text[] := array[]::text[];
  v_result jsonb;
  r record;
  v_handler regprocedure;
begin
  if v_club is null then
    raise exception 'template:no_club_context' using errcode = 'P0001';
  end if;
  select * into v_c from public.club c where c.id = v_club for update;
  if v_staff is not null then
    if not exists (select 1 from platform.platform_staff s where s.id = v_staff and s.active) or not platform.can_see_club(v_club) or v_c.id is null then
      raise exception 'template:not_found' using errcode = 'P0001';       -- unassigned and missing look the same
    end if;
  elsif v_c.id is null then
    raise exception 'template:not_found' using errcode = 'P0001';
  elsif not app.has_any_role('owner') then
    raise exception 'template:not_allowed' using errcode = 'P0001';
  end if;
  select * into v_t from platform.template t where t.id = p_template;
  if not found then
    raise exception 'template:not_found' using errcode = 'P0001';
  end if;
  if v_t.to_build then
    raise exception 'template:to_build' using errcode = 'P0001';
  end if;
  if v_c.template_applied_at is not null then
    raise exception 'template:already_applied' using errcode = 'P0001';
  end if;
  if v_c.status not in ('draft', 'testing') then
    raise exception 'template:not_a_start' using errcode = 'P0001';
  end if;

  for r in select i.kind, i.key, i.value from platform.template_item i where i.template_id = p_template order by i.kind, i.key loop
    if r.kind = 'setting' then
      continue when r.value = 'null'::jsonb;                              -- a TBD stays unset (AC9)
      insert into public.club_setting (club_id, key, value) values (v_club, r.key, r.value);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    elsif r.kind = 'opening_hours' then
      insert into public.opening_hours (club_id, weekday, open, close)
        values (v_club, r.key::smallint, (r.value ->> 'open')::time, (r.value ->> 'close')::time);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    elsif r.kind = 'label' then
      insert into public.club_setting (club_id, key, value) values (v_club, r.key || '_label', r.value);
      v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
    else
      select h.handler into v_handler from app.template_handlers h where h.kind = r.kind;
      if v_handler is null then
        if not (r.kind = any (v_pending)) then v_pending := v_pending || r.kind; end if;
      else
        execute format('select %s($1, $2, $3)', v_handler::regproc::text) using v_club, r.key, r.value;
        insert into public.club_template_copy (club_id, kind, key) values (v_club, r.kind, r.key);
        v_copied := jsonb_set(v_copied, array[r.kind], to_jsonb(coalesce((v_copied ->> r.kind)::integer, 0) + 1));
      end if;
    end if;
  end loop;

  update public.club set template_id = p_template, template_applied_at = app.now() where id = v_club;
  v_result := jsonb_build_object('template', v_t.key, 'copied', v_copied, 'pending', to_jsonb(v_pending));
  perform audit.note('template.applied', 'club', v_club, v_result, null);
  if v_staff is not null then
    perform platform.write_audit('club.template_applied', v_club, 'club', v_club::text, v_result, null, null);
  end if;
  return v_result;
end $$;
