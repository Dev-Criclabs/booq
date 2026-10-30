-- F10-T07 / migration 0606: policies and grants for the F10 tables. F10 design 9; FA 4.3. Requirements LINE-03,
-- CC-2; decisions D27, D149. The restrictive tenant policies of 0601 to 0603 keep every app and worker row to the
-- club in the context; these add what each role may do inside it.
--   booq_worker (the sender, the rich menu build): reads and moves outbox rows on, reads the switches and the labels,
--     builds rich_menu rows. Outbox rows are created only by app.enqueue_message (0605).
--   booq_app: the owner reads and edits the six labels (D114) and reads the build status. Nobody reads the outbox.
--   booq_platform: reads the labels and the build status of the clubs it may see (setup data, D27); never the
--     outbox or the switches (class D). Its usage and health reads are in 0604.
-- The LINE token stays with the worker: app.read_secret (booq_app) serves only line_channel_secret, which the
-- webhook needs (D149); app.read_secret_worker serves the token (migration 0012).

-- message_outbox: the sender's claim (FOR UPDATE SKIP LOCKED) and its result columns only.
grant select, update (status, void_reason, attempts, last_error, sent_at) on public.message_outbox to booq_worker;
grant execute on function app.message_params_ok(jsonb) to booq_worker;   -- the params CHECK runs again on an update
create policy message_outbox_worker_read on public.message_outbox for select to booq_worker using (true);
create policy message_outbox_worker_update on public.message_outbox for update to booq_worker using (true) with check (true);

-- notification_pref: the sender checks the switches at send time (D94).
grant select on public.notification_pref to booq_worker;
create policy notification_pref_worker_read on public.notification_pref for select to booq_worker using (true);

-- rich_menu_label: the owner's six labels; no delete (an unset label goes back to the default key by null).
grant select, insert, update (label_th, label_en) on public.rich_menu_label to booq_app;
create policy rich_menu_label_owner on public.rich_menu_label for all to booq_app
  using (app.has_any_role('owner')) with check (app.has_any_role('owner'));
grant select on public.rich_menu_label to booq_worker;
create policy rich_menu_label_worker_read on public.rich_menu_label for select to booq_worker using (true);
grant select on public.rich_menu_label to booq_platform;
create policy rich_menu_label_platform_read on public.rich_menu_label for select to booq_platform using (platform.can_see_club(club_id));

-- rich_menu: built by the worker (buildRichMenu, F10-T12); the owner sees the result in A16 and P2 shows it.
grant select, insert, update (line_rich_menu_id, status, error, rendered_at, uploaded_at) on public.rich_menu to booq_worker;
create policy rich_menu_worker on public.rich_menu for all to booq_worker using (true) with check (true);
grant select on public.rich_menu to booq_app;
create policy rich_menu_owner_read on public.rich_menu for select to booq_app using (app.has_any_role('owner'));
grant select on public.rich_menu to booq_platform;
create policy rich_menu_platform_read on public.rich_menu for select to booq_platform using (platform.can_see_club(club_id));
