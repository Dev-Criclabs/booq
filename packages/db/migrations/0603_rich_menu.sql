-- F10-T04 / migration 0603: rich_menu_label and rich_menu. F10 design 4.1 and 5.5. Requirements
-- LINE-02-AC1, AC2; decisions D54 (the six links are fixed in code and never stored), D92 (one image with
-- Thai and English labels, one menu per club), D114 (the owner edits the labels).
-- Class S (setup). The owner's, the worker's and the platform's grants and policies are F10-T07 (0606);
-- until then only the definer functions reach these tables.

-- Six tiles per club: tile 1 to 6, one row each. A label left unset means the default L key for that tile
-- (locales/pending/F10.json, F10-T20); the text of a default is never copied into the table.
create table public.rich_menu_label (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  tile smallint not null,
  label_th text,
  label_en text,
  primary key (club_id, id),
  constraint rich_menu_label_tile_range check (tile between 1 and 6),
  constraint rich_menu_label_one_per_tile unique (club_id, tile),
  constraint rich_menu_label_th_present check (label_th is null or btrim(label_th) <> ''),
  constraint rich_menu_label_en_present check (label_en is null or btrim(label_en) <> '')
);

-- Each build of the club's menu. One active row per club; the build makes the new menu default only after
-- its upload succeeds, then supersedes the old one, so a failure leaves the old menu working (LINE-02-AC8).
create table public.rich_menu (
  club_id uuid not null references public.club (id),
  id uuid not null default gen_random_uuid(),
  line_rich_menu_id text,                      -- LINE's id for the menu, once created there
  image_sha256 text not null,
  labels_hash text not null,
  status text not null default 'building',
  error text,                                  -- a code, never a message body
  rendered_at timestamptz,
  uploaded_at timestamptz,
  created_at timestamptz not null default app.now(),
  primary key (club_id, id),
  constraint rich_menu_status_values check (status in ('building', 'active', 'failed', 'superseded')),
  constraint rich_menu_image_sha256_format check (image_sha256 ~ '^[0-9a-f]{64}$'),
  constraint rich_menu_labels_hash_format check (labels_hash ~ '^[0-9a-f]{64}$'),
  constraint rich_menu_failed_has_error check ((status = 'failed') = (error is not null)),
  constraint rich_menu_uploaded_has_line_id check (status not in ('active', 'superseded') or (line_rich_menu_id is not null and uploaded_at is not null)),
  constraint rich_menu_line_id_unique unique (club_id, line_rich_menu_id)
);
create unique index rich_menu_one_active on public.rich_menu (club_id) where status = 'active';

do $$
declare t text;
begin
  foreach t in array array['rich_menu_label', 'rich_menu'] loop
    execute format('alter table public.%I owner to booq_owner', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public', t);
    execute format($f$create policy %1$s_tenant on public.%1$I as restrictive for all to booq_app, booq_worker
                      using (club_id = app.club_id()) with check (club_id = app.club_id())$f$, t);
    execute format('create policy %1$s_definer on public.%1$I for all to booq_owner using (true) with check (true)', t);
  end loop;
end $$;

-- A label change is audited (LINE-02-AC10, PLAT-04). The build's own audit entry is F10-T12.
select audit.register('public.rich_menu_label', array['id']);
