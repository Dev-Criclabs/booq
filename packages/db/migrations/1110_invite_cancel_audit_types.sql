-- F11 / migration 1110: two A17 helpers (ADMIN-17; orchestrator note from lane 2).
--   app.cancel_staff_invite(invite)  the owner ends a pending staff or coach invite that nobody has used: it expires now, so it leaves the
--                                    pending list and can no longer be redeemed (redemption needs expires_at in the future). The owner and
--                                    tester invites of the platform are not touched. A used, expired or unknown invite is not found.
--   app.audit_record_types()         the record types the A17 filter offers: the audited tables of the club schema, from the audit registry,
--                                    owner only. record_type in an audit entry is the table name (0005).
create function app.cancel_staff_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.staff_owner_only();
begin
  update public.club_invite set expires_at = app.now()
   where club_id = v_club and id = p_invite and kind in ('staff', 'coach') and used_at is null and expires_at > app.now();
  if not found then
    raise exception 'staff:not_found' using errcode = 'P0001';
  end if;
  perform audit.note('invite.cancelled', 'club_invite', p_invite, '{}'::jsonb);
end $$;
alter function app.cancel_staff_invite(uuid) owner to booq_owner;
revoke all on function app.cancel_staff_invite(uuid) from public;
grant execute on function app.cancel_staff_invite(uuid) to booq_app;

create function app.audit_record_types() returns setof text
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  if app.club_id() is null or not app.has_any_role('owner') then
    raise exception 'audit: not allowed' using errcode = '42501';
  end if;
  return query select r.table_name from audit.registry r where r.table_schema = 'public' order by r.table_name;
end $$;
alter function app.audit_record_types() owner to booq_owner;
revoke all on function app.audit_record_types() from public;
grant execute on function app.audit_record_types() to booq_app;
