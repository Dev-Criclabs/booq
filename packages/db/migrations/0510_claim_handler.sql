-- F06-T08 / migration 0510: imported balances move to the person who claims them. F06 design 4.8.
-- Requirements: PLAT-06-AC3, AC7, PKG-01-AC1 to AC3; decisions D13, D105, D154.
--
-- An imported player (0103) has value written for them with reason import: wallet rows and packages.
-- Until a claim is confirmed that value is inert: every F06 function that spends, reserves or lists
-- value refuses an unclaimed or merged record (customer_not_claimed, 0505 to 0507). When the front desk
-- confirms a claim, app.claim_confirm runs the registered handlers in its transaction; F06's moves the
-- value by paired append-only rows of the new reason import_transfer (D154), never an edit:
--   wallet:   -b on the imported record, +b on the claimant (b = the imported balance, when above zero)
--   packages: for each imported package with r credits left, -r on it, and a new package for the claimant
--             with the same product snapshot and the same expiry (no extension, D88), credited +r
-- The claimant's copy starts at credits_total 0 and holds exactly the +r row, so both halves are pairs
-- and the import and import_transfer rows of a club still add up to what was imported (PKG-01-AC1).
-- Keyed claim_wallet:{imported}:{claimant}, claim_wallet_in:{...}, claim_pkg:{old}:{claimant} and
-- claim_pkg_in:{...}: a retried confirm transfers once.

-- import_transfer joins both reason sets. It is written only by the claim transfer (its keys start with
-- claim_), signed and never zero.
alter table public.credit_ledger drop constraint credit_ledger_reason_values;
alter table public.credit_ledger add constraint credit_ledger_reason_values
  check (reason in ('reserve', 'return', 'use', 'forfeit', 'expire', 'adjust', 'import', 'import_transfer'));
alter table public.credit_ledger add constraint credit_ledger_import_transfer_key
  check (reason <> 'import_transfer' or (dedupe_key is not null and dedupe_key like 'claim\_%'));

alter table public.wallet_ledger drop constraint wallet_ledger_reason_values;
alter table public.wallet_ledger add constraint wallet_ledger_reason_values check (reason in
  ('refund', 'late_payment', 'wrong_amount', 'duplicate_payment', 'referral_reward', 'spend', 'return', 'adjust', 'import', 'import_transfer', 'expire'));
alter table public.wallet_ledger drop constraint wallet_ledger_sign;
alter table public.wallet_ledger add constraint wallet_ledger_sign check (case reason
  when 'spend' then change_satang < 0
  when 'expire' then change_satang < 0
  when 'adjust' then true
  when 'import_transfer' then true
  else change_satang > 0 end);
alter table public.wallet_ledger add constraint wallet_ledger_import_transfer_key
  check (reason <> 'import_transfer' or (dedupe_key is not null and dedupe_key like 'claim\_%'));

-- A claimant's copy of an imported package holds its credit as the +r import_transfer row, so it starts at
-- zero. A package that was sold (it has an order) still starts with its credits.
alter table public.customer_package drop constraint customer_package_credits_total_check;
alter table public.customer_package add constraint customer_package_credits_total_check
  check (credits_total > 0 or (credits_total = 0 and order_id is null));

create function app.f06_claim_transfer(p_club uuid, p_imported uuid, p_claimant uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_balance bigint;
  v_moved_wallet bigint := 0;
  v_moved_credits integer := 0;
  p record;
  v_left integer;
  v_new uuid;
begin
  if v_club is null or p_club is distinct from v_club then
    raise exception 'claim transfer for another club' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.app_user u where u.club_id = v_club and u.id = p_imported and u.merged_into = p_claimant) then
    raise exception 'claim transfer: the record is not merged into this person' using errcode = 'P0001';
  end if;
  perform app.require_claimed_customer(p_claimant);
  -- Lock order (FA 3.4): both customers and their wallet anchors, lower id first, then the packages in id order.
  if p_imported < p_claimant then
    perform app.lock_wallet(p_imported);
    perform app.lock_wallet(p_claimant);
  else
    perform app.lock_wallet(p_claimant);
    perform app.lock_wallet(p_imported);
  end if;

  v_balance := app.wallet_sum(p_imported);
  if v_balance > 0 then
    insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key)
      values (v_club, p_imported, -v_balance, 'import_transfer', 'claim_wallet:' || p_imported || ':' || p_claimant)
      on conflict (club_id, dedupe_key) do nothing;
    if found then
      insert into public.wallet_ledger (club_id, customer_id, change_satang, reason, dedupe_key)
        values (v_club, p_claimant, v_balance, 'import_transfer', 'claim_wallet_in:' || p_imported || ':' || p_claimant);
      v_moved_wallet := v_balance;
    end if;
  end if;

  for p in select cp.* from public.customer_package cp
            where cp.club_id = v_club and cp.customer_id = p_imported order by cp.id for update loop
    v_left := app.package_credits_left(p.id);
    continue when v_left <= 0;
    insert into public.credit_ledger (club_id, package_id, change, reason, dedupe_key)
      values (v_club, p.id, -v_left, 'import_transfer', 'claim_pkg:' || p.id || ':' || p_claimant)
      on conflict (club_id, dedupe_key) do nothing;
    continue when not found;
    insert into public.customer_package (club_id, customer_id, product_id, product_snapshot, credits_total, purchased_at, expires_at)
      values (v_club, p_claimant, p.product_id, p.product_snapshot, 0, p.purchased_at, p.expires_at)
      returning id into v_new;
    insert into public.credit_ledger (club_id, package_id, change, reason, dedupe_key)
      values (v_club, v_new, v_left, 'import_transfer', 'claim_pkg_in:' || p.id || ':' || p_claimant);
    perform app.package_reminder_hook(v_new);
    v_moved_credits := v_moved_credits + v_left;
  end loop;

  -- The audit entry names the staff member who confirmed (the caller of claim_confirm) and the amounts.
  perform audit.note('claim.balances_transferred', 'app_user', p_claimant,
                     jsonb_build_object('imported_user_id', p_imported, 'wallet_satang', v_moved_wallet, 'credits', v_moved_credits));
end $$;
alter function app.f06_claim_transfer(uuid, uuid, uuid) owner to booq_owner;
revoke all on function app.f06_claim_transfer(uuid, uuid, uuid) from public;

insert into app.claim_handlers (handler_key, handler)
  values ('wallet_transfer', 'app.f06_claim_transfer(uuid, uuid, uuid)'::regprocedure);
