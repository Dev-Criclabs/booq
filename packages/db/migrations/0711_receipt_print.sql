-- F13-T12, T13 / migration 0711: what a receipt PDF needs from the database, in one place. F13 design 4.4, 4.5, 5; RCPT-01-AC11, RCPT-02-AC8.
--   * app.receipt_for_print(receipt) returns the stored snapshot, the club's legal details, the void reason and the language to use, and
--     says whether this print is the original or a copy. The caller must be staff who may print (owner, accountant, front desk) or the
--     customer of that receipt; anyone else, and another club, gets receipt:not_found (the same as a receipt that does not exist).
--   * The first print by the customer is the original (design 4.4: a player's first view is not marked Copy); every later print by anyone,
--     and every print by staff, is a Copy. That first print is remembered in receipt_print, one row per receipt, append-only.
--   * A staff print is written to the club audit log (receipt.printed) with the staff member as actor, the receipt number and the language
--     (the same trail as an export, PLAT-06-AC15); a customer's own print is not an audit event.
--   * The legal name, tax id, branch and address come from the club record. The customer's language is the player's saved one, else
--     the club's default language (never invented).
-- receipt_print is class D, test rows go with the purge (before the receipts they point at), and no role writes it directly.
create table public.receipt_print (
  club_id uuid not null,
  receipt_id uuid not null,
  printed_by uuid not null,
  printed_at timestamptz not null default app.now(),
  is_test boolean not null default false,
  primary key (club_id, receipt_id),
  foreign key (club_id, receipt_id) references public.receipt (club_id, id),
  foreign key (club_id, printed_by) references public.app_user (club_id, id)
);
create trigger receipt_print_no_change before update or delete on public.receipt_print for each row execute function app.refuse_change();
create trigger receipt_print_no_truncate before truncate on public.receipt_print for each statement execute function app.refuse_change();
alter table public.receipt_print owner to booq_owner;
alter table public.receipt_print enable row level security;
alter table public.receipt_print force row level security;
revoke all on public.receipt_print from public;
create policy receipt_print_tenant on public.receipt_print as restrictive for all to booq_app, booq_worker using (club_id = app.club_id()) with check (club_id = app.club_id());
create policy receipt_print_definer on public.receipt_print for all to booq_owner using (true) with check (true);
select app.register_test_table('public.receipt_print', 257);

create function app.receipt_for_print(p_receipt uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  r public.receipt%rowtype;
  v_staff boolean := app.has_any_role('owner', 'accountant', 'front_desk');
  v_lang text;
  v_void text;
  v_original boolean := false;
  c public.club%rowtype;
begin
  if v_club is null or v_user is null then
    raise exception 'receipt:not_found' using errcode = 'P0001';
  end if;
  select * into r from public.receipt x where x.club_id = v_club and x.id = p_receipt;
  if not found or not (v_staff or r.customer_id = v_user) then
    raise exception 'receipt:not_found' using errcode = 'P0001';
  end if;
  select * into c from public.club where id = v_club;
  select u.language into v_lang from public.app_user u where u.club_id = v_club and u.id = r.customer_id;
  select v.reason into v_void from public.receipt_void v where v.club_id = v_club and v.receipt_id = p_receipt;
  if r.customer_id = v_user then
    insert into public.receipt_print (club_id, receipt_id, printed_by) values (v_club, p_receipt, v_user) on conflict do nothing;
    v_original := found;
  else
    perform audit.note('receipt.printed', 'receipt', p_receipt, jsonb_build_object('number', r.number));
  end if;
  return jsonb_build_object(
    'number', r.number, 'kind', r.kind, 'status', r.status, 'issued_at', r.issued_at, 'vat_flag', r.vat_flag, 'is_test', r.is_test,
    'customer_name', r.customer_name_snapshot, 'total_satang', r.total_satang, 'lines', r.lines, 'void_reason', v_void,
    'language', coalesce(v_lang, c.default_language),
    'club', jsonb_build_object('legal_name', c.legal_name, 'name_th', c.name_th, 'tax_id', c.tax_id, 'tax_branch', c.tax_branch, 'registered_address', c.registered_address),
    'original', v_original);
end $$;
alter function app.receipt_for_print(uuid) owner to booq_owner;
revoke all on function app.receipt_for_print(uuid) from public;
grant execute on function app.receipt_for_print(uuid) to booq_app;
