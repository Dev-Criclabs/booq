-- F01 / migration 0060: the LINE Official Account's basic id joins public.public_club_config (orchestrator, 31 Oct).
-- The "Add on LINE" button needs it, and it is public by nature: anyone can add the OA, and the id is what they search for. It is the
-- one new column (appended last, so the view is replaced in place); no channel id, secret, owner contact or tax detail joins it (D103).
-- Redefines the view of 0048, so it is numbered above it (D159). Null while no LINE connection or no id is set.
create or replace view public.public_club_config with (security_barrier = true) as
select c.name_th, c.name_en, c.default_language, c.status, l.liff_id, app.current_notice_version() as notice_version, l.oa_basic_id
  from public.club c
  left join public.line_connection l on l.club_id = c.id
 where c.id = app.club_id();
