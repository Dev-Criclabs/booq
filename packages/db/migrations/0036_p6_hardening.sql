-- F01-T23 part c / migration 0036: review T18 R3 and R4 on the P6 writer (migration 0008).
--   R3: the player and secret key filter over-refused names that are setup facts: feature_key,
--       check_key and setting_key are allowed by exact name. `key` on its own, api_key, hmac_key and
--       secret_key stay refused.
--   R4: write_audit names only a club the staff member can see, and only a support session that is
--       theirs and belongs to that club. A sign in event (auth.*) and an entry with no club are unchanged.

create or replace function platform.assert_setup_detail(j jsonb) returns void
language plpgsql immutable set search_path = pg_catalog
as $$
declare k text;
begin
  case jsonb_typeof(j)
    when 'object' then
      for k in select jsonb_object_keys(j) loop
        if k not in ('secret_last4', 'feature_key', 'check_key', 'setting_key') and (
             k in ('date_of_birth', 'line_user_id')
             or string_to_array(k, '_') && array['dob', 'birthday', 'booking', 'bookings', 'slip', 'slips', 'receipt', 'receipts',
                                                  'wallet', 'balance', 'customer', 'customers', 'player', 'players',
                                                  'note', 'notes', 'password', 'token', 'secret', 'hmac', 'ciphertext', 'key']
           ) then
          raise exception 'platform audit detail: "%" is not allowed (player, payment or secret data)', k using errcode = 'P0001';
        end if;
        perform platform.assert_setup_detail(j -> k);
      end loop;
    when 'array' then
      for k in select i::text from generate_series(0, jsonb_array_length(j) - 1) as i loop
        perform platform.assert_setup_detail(j -> k::int);
      end loop;
    else null;
  end case;
end $$;

create or replace function platform.write_audit(
  p_action text, p_club uuid, p_target_type text, p_target_id text, p_detail jsonb, p_reason text, p_support_session uuid
) returns void
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_staff uuid := platform.staff_id();
  v_name text;
begin
  if v_staff is not null then
    select s.display_name into v_name from platform.platform_staff s where s.id = v_staff and s.active;
    if v_name is null then
      raise exception 'platform audit: unknown or inactive staff member' using errcode = 'P0001';
    end if;
  elsif p_action not like 'auth.%' then
    raise exception 'platform audit: a staff member is required' using errcode = 'P0001';
  end if;
  if p_club is not null and p_action not like 'auth.%' and not platform.can_see_club(p_club) then
    raise exception 'platform audit: the club is not one this staff member can see' using errcode = 'P0001';
  end if;
  if p_support_session is not null and not exists (
       select 1 from platform.support_session ss
        where ss.id = p_support_session and ss.staff_id = v_staff and (p_club is null or ss.club_id = p_club)) then
    raise exception 'platform audit: the support session is not this staff member''s' using errcode = 'P0001';
  end if;
  perform platform.assert_setup_detail(coalesce(p_detail, '{}'::jsonb));
  insert into platform.audit_log (staff_id, staff_name_at_time, action, club_id, target_type, target_id, detail, reason, support_session_id)
    values (v_staff, v_name, p_action, p_club, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb), p_reason, p_support_session);
end $$;
