-- F01 / migration 0054: the accountant reads business settings only (QA-F01-2; ROLE-01-AC8; D115).
-- Policy club_setting_read (0002) let the owner, front desk and the accountant read every club setting, so the accountant could read
-- the hold time, the cancel window, the rest cap and the others, which are operating rules. D115: the Accountant reads business and tax
-- settings only. The registry (packages/domain, settings-registry.ts) already has a scope for each key; this gives the database the
-- same fact, so the rule holds for any query and not only for the route that filters. `rules` is the default, the safe one: a key that
-- a later migration adds with no scope is not readable by the accountant until it is marked business. Today the one business setting
-- is vat_enabled. A test keeps the two lists equal. Owner and front desk read every setting, as before.
alter table app.setting_keys add column scope text not null default 'rules' check (scope in ('rules', 'business'));
update app.setting_keys set scope = 'business' where setting_key = 'vat_enabled';

drop policy club_setting_read on public.club_setting;
create policy club_setting_read on public.club_setting for select to booq_app
  using (
    app.has_any_role('owner', 'front_desk')
    or (app.has_any_role('accountant') and exists (select 1 from app.setting_keys k where k.setting_key = club_setting.key and k.scope = 'business'))
  );
