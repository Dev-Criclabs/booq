-- F11-T08 / migration 1104: the history of one booking for A2 (ADMIN-04; F11 design 5.3, 6.4). The owner reads the audit log directly
-- (policy audit_entry_owner_read, route GET /staff/audit); front desk may not, so the history of a single booking comes through this
-- definer function, owner and front desk only. It merges the audit entries of the booking (who changed which fields, from where, with the
-- reason) and its cancel and mark rows (booking_cancel: kind, outcome, version, reason). Personal values never appear: only the names of
-- the personal fields that changed. Newest first. A booking of another club, or none, gives no rows.
-- audit_entry has row security forced, and only the application owner role and the anonymiser had a read policy. The definer function reads as
-- booq_owner, so it needs its own read policy, scoped to the club of the context like every other.
create policy audit_entry_definer_read on public.audit_entry for select to booq_owner using (club_id = app.club_id());

create function public.booking_history(p_booking uuid)
  returns table (at timestamptz, source_kind text, action text, actor_name text, source text, reason text, detail jsonb, pii_fields text[])
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
begin
  if v_club is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'booking: not allowed' using errcode = '42501';
  end if;
  return query
    select x.at, x.source_kind, x.action, x.actor_name, x.source, x.reason, x.detail, x.pii_fields
      from (
        select a.occurred_at as at, 'audit'::text as source_kind, a.action, a.actor_label as actor_name, a.source, a.reason,
               jsonb_build_object('old', a.old_value, 'new', a.new_value) as detail,
               coalesce(array(select jsonb_object_keys(coalesce(a.pii_new, a.pii_old, '{}'::jsonb))), '{}'::text[]) as pii_fields, a.seq as ord
          from public.audit_entry a
         where a.club_id = v_club and a.record_type = 'booking' and a.record_id = p_booking
        union all
        select c.created_at, 'cancel', c.kind, coalesce(u.display_name, case when c.by_user is null then null end), null::text, c.reason,
               jsonb_build_object('outcome', c.outcome, 'version', c.version, 'returned', c.returned, 'creditLost', c.credit_lost), '{}'::text[], 0
          from public.booking_cancel c left join public.app_user u on u.club_id = c.club_id and u.id = c.by_user
         where c.club_id = v_club and c.booking_id = p_booking
      ) x
     order by x.at desc, x.ord desc;
end $$;
alter function public.booking_history(uuid) owner to booq_owner;
revoke all on function public.booking_history(uuid) from public;
grant execute on function public.booking_history(uuid) to booq_app;
