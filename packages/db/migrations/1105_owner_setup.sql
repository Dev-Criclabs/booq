-- F11-T09 / migration 1105: the owner's A0 Setup checklist (ADMIN-02; F11 design 6.5, D54, D168).
--   public.owner_setup_done        one row per club: the owner pressed "Tell BOOQ I'm done". Class S (platform staff read that it was said, so P3
--                                  can show it, and nothing else about the club). Written only by app.owner_tell_done; the page stays until Go live.
--   app.owner_setup_view()         the owner's steps 6 to 8 with a done flag each, computed from the club's own rows, read only. The tests are:
--                                    brand           all six rich menu tiles have a Thai and an English label (D54);
--                                    products_rules  a court price or a package product with a price is set, and every setting the template
--                                                    marks required is set (the same function the Go live check uses);
--                                    people          the club has staff or a coach besides the owner, or an import was confirmed.
--                                  These are NOT registered in app.setup_steps, so they do not block Draft to Testing; the owner finishes them and
--                                  says so. (Assumption of the F11 design 14, item 2: the exact done tests are for the Reviewer to confirm.)
--   app.owner_tell_done()          owner only; records once; a repeat changes nothing and returns false.
create table public.owner_setup_done (
  club_id uuid primary key references public.club (id),
  done_at timestamptz not null default app.now(),
  done_by uuid not null,
  foreign key (club_id, done_by) references public.app_user (club_id, id)
);
alter table public.owner_setup_done owner to booq_owner;
alter table public.owner_setup_done enable row level security;
alter table public.owner_setup_done force row level security;
revoke all on public.owner_setup_done from public;
create policy owner_setup_done_tenant on public.owner_setup_done as restrictive for all to booq_app, booq_worker
  using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy owner_setup_done_definer on public.owner_setup_done for all to booq_owner using (true) with check (true);
create policy owner_setup_done_owner_read on public.owner_setup_done for select to booq_app using (app.has_any_role('owner'));
grant select on public.owner_setup_done to booq_app;
grant select on public.owner_setup_done to booq_platform;
create policy owner_setup_done_platform_read on public.owner_setup_done for select to booq_platform using (platform.can_see_club(club_id));
select audit.register('public.owner_setup_done', array['club_id']);

create function app.owner_setup_view() returns table (step_key text, done boolean, told_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_told timestamptz;
begin
  if v_club is null or not app.has_any_role('owner') then
    raise exception 'setup: not allowed' using errcode = '42501';
  end if;
  select d.done_at into v_told from public.owner_setup_done d where d.club_id = v_club;
  return query
    select 'brand'::text,
           (select count(*) from public.rich_menu_label l where l.club_id = v_club and l.label_th is not null and l.label_en is not null) = 6,
           v_told
    union all
    select 'products_rules'::text,
           (exists (select 1 from public.court_price_rule r where r.club_id = v_club)
            or exists (select 1 from public.package_product p where p.club_id = v_club and p.active and p.price_satang is not null))
           and app.launch_template_settings(v_club),
           v_told
    union all
    select 'people'::text,
           exists (select 1 from public.app_user_role r where r.club_id = v_club and r.role in ('front_desk', 'accountant', 'coach'))
           or exists (select 1 from public.import_job j where j.club_id = v_club and j.status = 'confirmed'),
           v_told;
end $$;
alter function app.owner_setup_view() owner to booq_owner;
revoke all on function app.owner_setup_view() from public;
grant execute on function app.owner_setup_view() to booq_app;

create function app.owner_tell_done() returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner') then
    raise exception 'setup: not allowed' using errcode = '42501';
  end if;
  if (select c.status from public.club c where c.id = v_club) not in ('draft', 'testing') then
    perform app.refuse('club_not_available');                  -- the page ends at Go live
  end if;
  insert into public.owner_setup_done (club_id, done_by) values (v_club, app.user_id()) on conflict do nothing;
  return found;
end $$;
alter function app.owner_tell_done() owner to booq_owner;
revoke all on function app.owner_tell_done() from public;
grant execute on function app.owner_tell_done() to booq_app;
