-- F13-T05 / migration 0704: app.void_receipt(receipt, reason). F13 design 4.3. Requirements: RCPT-01-AC9, AC10, AC13; PLAT-04; D106.
-- Owner only (the role is read from the context, never from an argument). The reason is required and not blank. A void only marks the
-- receipt: number, lines and total stay, the number is never reused, and no order, booking, credit or wallet row is touched. The
-- receipt_void record keeps the reason and who voided; the club audit log records the void with the owner as the actor and the
-- receipt number, not the free text of the reason. The status change is the one update receipt_guard (0701) allows, made here as
-- the function owner. Errors are receipt:<code> (P0001): forbidden, not_found, reason_required, already_void.
create function app.void_receipt(p_receipt uuid, p_reason text) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_user uuid := app.user_id();
  r public.receipt%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\r\n'), '');
begin
  if v_club is null or v_user is null or not app.has_any_role('owner') then
    raise exception 'receipt:forbidden' using errcode = 'P0001';
  end if;
  select * into r from public.receipt where club_id = v_club and id = p_receipt for update;
  if not found then
    raise exception 'receipt:not_found' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'receipt:reason_required' using errcode = 'P0001';
  end if;
  if r.status = 'void' then
    raise exception 'receipt:already_void' using errcode = 'P0001';
  end if;
  insert into public.receipt_void (club_id, receipt_id, reason, voided_by) values (v_club, p_receipt, v_reason, v_user);
  update public.receipt set status = 'void' where club_id = v_club and id = p_receipt;
  perform audit.note('receipt.voided', 'receipt', p_receipt, jsonb_build_object('number', r.number));
end $$;
alter function app.void_receipt(uuid, text) owner to booq_owner;
revoke all on function app.void_receipt(uuid, text) from public;
grant execute on function app.void_receipt(uuid, text) to booq_app;
