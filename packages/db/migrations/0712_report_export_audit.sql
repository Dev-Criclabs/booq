-- F13-T14 / migration 0712: every report or close export is audited (R2-AC9, RCPT-03-AC7, PLAT-06-AC15, PLAT-04). The CSV is built by the
-- route from the same query as the screen; this records who exported what, for which range and how many rows, in the club audit log. Owner
-- and accountant only (from the context). The entry holds the report name, the range and the row count, never a row.
create function app.audit_report_export(p_name text, p_from date, p_to date, p_rows integer) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or app.user_id() is null or not app.has_any_role('owner', 'accountant') then
    raise exception 'report:forbidden' using errcode = 'P0001';
  end if;
  if p_name is null or p_name !~ '^[a-z][a-z-]{1,40}$' or p_rows is null or p_rows < 0 then
    raise exception 'report:invalid_range' using errcode = 'P0001';
  end if;
  perform audit.note('report.exported', 'report', gen_random_uuid(), jsonb_build_object('name', p_name, 'from', p_from, 'to', p_to, 'rows', p_rows));
end $$;
alter function app.audit_report_export(text, date, date, integer) owner to booq_owner;
revoke all on function app.audit_report_export(text, date, date, integer) from public;
grant execute on function app.audit_report_export(text, date, date, integer) to booq_app;
