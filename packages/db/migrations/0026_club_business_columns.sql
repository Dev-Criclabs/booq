-- Security fix / migration 0026 (decisions D2, D103; F01-T06): the club's business columns are not for guests or players.
-- Until now booq_app held SELECT on all of public.club and the club_read policy was using (true), so any club
-- context, a guest included, could read the owner's phone, the tax id and the billing dates. A column grant is
-- per database role, not per request role, so the fix has two parts:
--   1. booq_app keeps SELECT on the public columns only. `select *` from public.club is refused for it, so code
--      names its columns. booq_worker is a server job (receipts need the tax details) and is unchanged.
--   2. public.club_business is the one way into the business columns for the app role: it returns the context
--      club's row only to owner, front desk and accountant. A guest, a player or a coach gets no row. A guest
--      reads public.public_club_config (0024) instead.
-- Writes are unchanged: the owner's column UPDATE grant and policy stay (an update needs SELECT only on the
-- columns its WHERE reads). The definer functions are unaffected: club_definer_read stays.
revoke select on public.club from booq_app;
grant select (id, slug, name_th, name_en, status, payment_option, template_id, receipt_prefix, default_language, created_at)
  on public.club to booq_app;

create view public.club_business with (security_barrier = true) as
select c.id as club_id, c.legal_name, c.tax_id, c.tax_branch, c.registered_address,
       c.owner_name, c.owner_phone, c.owner_line, c.owner_email,
       c.plan_trial_ends_at, c.billing_starts_at, c.allow_booq_changes_until, c.allow_booq_changes_set_at
  from public.club c
 where c.id = app.club_id() and app.has_any_role('owner', 'front_desk', 'accountant');
alter view public.club_business owner to booq_owner;
revoke all on public.club_business from public;
grant select on public.club_business to booq_app;
