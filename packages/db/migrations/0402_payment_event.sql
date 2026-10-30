-- F05-T01 / migration 0402: payment_event (the callback log) and owner_flag. F05 design 4.3.
-- Requirements: PAY-02-AC5 to AC15, PAY-01-AC7; decisions D71, D75, D76. Class D.
-- payment_event is append-only and holds nothing personal: the event name, the charge id, the
-- result of the lookup, a hash of the raw body (the body itself is never stored, D76).

create table public.payment_event (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  gateway text not null default 'beam',
  gateway_charge_id text not null check (gateway_charge_id <> ''),
  event_type text not null check (event_type <> ''),
  received_at timestamptz not null default app.now(),
  body_hash text not null,
  signature_ok boolean not null,
  looked_up_status text,
  looked_up_amount_satang integer,
  looked_up_reference text,
  outcome text not null,
  payment_id uuid,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, payment_id) references public.payment (club_id, id),
  constraint payment_event_dedupe unique (club_id, gateway, gateway_charge_id, event_type),
  constraint payment_event_body_hash check (body_hash ~ '^[0-9a-f]{64}$'),
  constraint payment_event_outcome_values check (outcome in
    ('applied', 'applied_late', 'wallet_late', 'wallet_duplicate', 'wallet_cancelled', 'wallet_wrong_amount', 'mismatch',
     'unknown_charge', 'ignored', 'duplicate', 'bad_signature', 'lookup_failed'))
);
create trigger payment_event_append_only before update or delete on public.payment_event for each row execute function app.refuse_change();
create trigger payment_event_no_truncate before truncate on public.payment_event for each statement execute function app.refuse_change();

-- A banner for the owner: money needs a person's attention, or the Beam keys failed (D75).
create table public.owner_flag (
  club_id uuid not null,
  id uuid not null default gen_random_uuid(),
  kind text not null,
  payment_id uuid,
  status text not null default 'open',
  created_at timestamptz not null default app.now(),
  resolved_by uuid,
  resolved_at timestamptz,
  note text,
  is_test boolean not null default false,
  primary key (club_id, id),
  foreign key (club_id, payment_id) references public.payment (club_id, id),
  foreign key (club_id, resolved_by) references public.app_user (club_id, id),
  constraint owner_flag_kind_values check (kind in ('wrong_amount', 'key_check_failed')),
  constraint owner_flag_status_values check (status in ('open', 'resolved')),
  constraint owner_flag_resolved_together check ((status = 'resolved') = (resolved_by is not null and resolved_at is not null)),
  constraint owner_flag_wrong_amount_has_payment check (kind <> 'wrong_amount' or payment_id is not null)
);
-- One open flag per payment and kind: a repeated callback does not pile them up.
create unique index owner_flag_open on public.owner_flag (club_id, kind, coalesce(payment_id, '00000000-0000-0000-0000-000000000000')) where status = 'open';
create trigger owner_flag_no_delete before delete on public.owner_flag for each row execute function app.refuse_change();

do $$
declare t text;
begin
  foreach t in array array['payment_event', 'owner_flag'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
    execute format('create policy %1$s_worker_read on public.%1$I for select to booq_worker using (true)', t);
    execute format('grant select on public.%I to booq_worker', t);
  end loop;
end $$;
-- The event log is for the owner and front desk reading the money trail; flags are the owner's banner.
create policy payment_event_staff_read on public.payment_event for select to booq_app using (app.has_any_role('owner', 'front_desk', 'accountant'));
create policy owner_flag_owner_read on public.owner_flag for select to booq_app using (app.has_any_role('owner'));
grant select on public.payment_event, public.owner_flag to booq_app;

select app.register_test_table('public.payment_event', 120);
select app.register_test_table('public.owner_flag', 255);
select audit.register('public.owner_flag', array['id']);
