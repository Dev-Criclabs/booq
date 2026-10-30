-- F01-T19 / migration 0031: the owner's support window (PLAT-02-AC4, AC5; review SR-02).
-- The only writer of club.allow_booq_changes_until and allow_booq_changes_set_at. SECURITY
-- DEFINER with a fixed search path; the club comes from app.club_id() and never from an argument;
-- the caller's role is read from the transaction. Go live, pause and resume clear the window
-- from inside app.set_club_status (F01-T20), which is the other definer function that writes it.
-- The 24 hour limit is the CHECK club_booq_window_max in migration 0002.

-- The definer runs as booq_owner, which row security also binds (FORCE): it may update only
-- the caller's own club row.
create policy club_owner_role_window on public.club for update to booq_owner
  using (id = app.club_id()) with check (id = app.club_id());

create function app.set_support_window(p_on boolean) returns timestamptz
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_club uuid := app.club_id();
  v_now timestamptz := app.now();
  v_until timestamptz;
begin
  if v_club is null then
    raise exception 'set_support_window: no club context' using errcode = 'P0001';
  end if;
  if p_on is null then
    raise exception 'set_support_window: the argument must be true or false' using errcode = 'P0001';
  end if;
  if not app.has_any_role('owner') then
    raise exception 'set_support_window: only the owner may change it' using errcode = '42501';
  end if;
  v_until := case when p_on then v_now + interval '24 hours' else null end;
  update public.club
     set allow_booq_changes_until = v_until,
         allow_booq_changes_set_at = case when p_on then v_now else null end
   where id = v_club;
  perform audit.note(case when p_on then 'support_window.on' else 'support_window.off' end, 'club', v_club,
                     jsonb_build_object('until', v_until), null);
  return v_until;
end $$;
alter function app.set_support_window(boolean) owner to booq_owner;
revoke all on function app.set_support_window(boolean) from public;
grant execute on function app.set_support_window(boolean) to booq_app;

-- The definer runs as booq_owner and writes its note through audit.note.
grant execute on function audit.note(text, text, uuid, jsonb, jsonb) to booq_owner;
