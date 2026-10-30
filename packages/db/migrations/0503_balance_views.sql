-- F06-T03 / migration 0503: the derived balances. F06 design 3.1 and 3.3; FA 2.3.
-- Requirements: PKG-01-AC1, PKG-03-AC3.
--
-- A balance is the sum of its ledger rows and a package status is a predicate of time and that
-- sum; neither is stored anywhere (PKG-01-AC1, FA 5.1). So a late expiry job never lets an expired
-- credit be used: the status reads app.now() itself. The views carry the club filter themselves
-- (they run as their owner, like the other views); who may read which rows, and the grants, are
-- F06-T11 (0513).

create view public.wallet_balance with (security_barrier = true) as
select l.club_id, l.customer_id, sum(l.change_satang)::bigint as balance_satang
  from public.wallet_ledger l
 where l.club_id = app.club_id()
 group by l.club_id, l.customer_id;

-- credits_left is after reserves: a credit reserved for a booking is no longer left (design 4.6).
create view public.package_balance with (security_barrier = true) as
select p.club_id, p.id as package_id, p.customer_id,
       (p.credits_total + coalesce((select sum(l.change) from public.credit_ledger l
                                     where l.club_id = p.club_id and l.package_id = p.id), 0))::integer as credits_left
  from public.customer_package p
 where p.club_id = app.club_id();

-- Expired wins over used up: the expiry sweep writes the remainder off, so an expired package
-- also has nothing left, and it must still read as expired.
create view public.package_status with (security_barrier = true) as
select b.club_id, b.package_id, b.customer_id, p.expires_at, b.credits_left,
       (case when p.expires_at <= app.now() then 'expired'
             when b.credits_left <= 0 then 'used_up'
             else 'active' end)::text as status
  from public.package_balance b
  join public.customer_package p on p.club_id = b.club_id and p.id = b.package_id;

do $$
declare v text;
begin
  foreach v in array array['wallet_balance', 'package_balance', 'package_status'] loop
    execute format('alter view public.%I owner to booq_owner', v);
    execute format('revoke all on public.%I from public', v);
  end loop;
end $$;
