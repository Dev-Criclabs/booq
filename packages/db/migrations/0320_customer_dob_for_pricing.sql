-- F04-T13-db / migration 0320: staff Pay prices a class or a court hour for the customer's price group, which needs the date of
-- birth (D12, D35). app.customer_dob_for_pricing(customer) returns that date and nothing else about the person, or null when
-- none is stored (Adult prices). Owner and front desk only; the club comes from app.club_id(). A person who is missing, of
-- another club, inactive, anonymised or an unclaimed or merged import (claim_state set, D105) raises 'customer: not found', the
-- same message for each (CC-1). Granted to booq_app.

create function app.customer_dob_for_pricing(p_customer uuid) returns date
language plpgsql stable security definer set search_path = pg_catalog, pg_temp
as $$
declare
  v_club uuid := app.club_id();
  v_dob date;
  v_found boolean;
begin
  if v_club is null or app.user_id() is null or not app.has_any_role('owner', 'front_desk') then
    raise exception 'customer: not allowed' using errcode = '42501';
  end if;
  select u.date_of_birth, true into v_dob, v_found
    from public.app_user u
   where u.club_id = v_club and u.id = p_customer and u.active and u.claim_state is null and u.anonymised_at is null;
  if not coalesce(v_found, false) then
    raise exception 'customer: not found' using errcode = 'P0001';
  end if;
  return v_dob;
end $$;
alter function app.customer_dob_for_pricing(uuid) owner to booq_owner;
revoke all on function app.customer_dob_for_pricing(uuid) from public;
grant execute on function app.customer_dob_for_pricing(uuid) to booq_app;
