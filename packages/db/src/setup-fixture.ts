// Test fixture (not product code): fills a club's data so the setup steps of migration 0034 pass,
// and records launch check results by the keys configured in platform.config. Shared by the
// lifecycle tests that need a club to move through Draft, Testing and Live.
export interface Querier {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function completeSetup(db: Querier, club: string): Promise<void> {
  const t = await db.query(`insert into platform.template (key, name) values ('t' || gen_random_uuid()::text, 'T') returning id`);
  await db.query(
    `update public.club set owner_name = 'Nok', owner_phone = '0812345678', owner_line = 'U00000000000000000000000000000002', owner_email = 'nok@example.com',
            template_id = $2, billing_starts_at = '2027-02-01T00:00:00Z', payment_option = 'beam' where id = $1`,
    [club, t.rows[0]?.id],
  );
  await db.query(`insert into public.location (club_id, id, name) values ($1, gen_random_uuid(), 'Main')`, [club]);
  await db.query(`insert into public.resource (club_id, location_id, name, sport) select $1, id, 'Court 1', 'tennis' from public.location where club_id = $1`, [club]);
  await db.query(`insert into public.opening_hours (club_id, weekday, open, close) values ($1, 1, '06:00', '24:00')`, [club]);
  await db.query(`insert into public.line_connection (club_id, tested_at) values ($1, app.now())`, [club]);
  await db.query(`insert into public.payment_connection (club_id, tested_at) values ($1, app.now())`, [club]);
  // The platform-wide privacy notice (D152, migration 0048): one published release is enough for every club.
  if ((await db.query(`select 1 from platform.legal_release`)).rows.length === 0) {
    const st = (await db.query(`insert into platform.platform_staff (auth_user_id, email, display_name, role) values (gen_random_uuid(), 'legal-' || gen_random_uuid()::text || '@booq.example', 'Legal', 'platform_admin') returning id`)).rows[0]?.['id'];
    await db.query(`insert into platform.legal_release (seq, published_by) values (1, $1)`, [st]);
    for (const kind of ['privacy', 'terms']) for (const lang of ['th', 'en']) {
      await db.query(`insert into platform.legal_text (seq, kind, language, title, body) values (1, $1, $2, 't', 'b')`, [kind, lang]);
    }
  }
}

export async function requiredLaunchKeys(db: Querier): Promise<string[]> {
  const r = await db.query(`select value from platform.config where key = 'required_launch_checks'`);
  return (r.rows[0]?.['value'] as Array<{ key: string }>).map((x) => x.key);
}

const REQUIRED_SETTINGS: Array<[string, unknown]> = [
  ['hold_minutes', 15], ['booking_window_days', 30], ['cancel_window_hours', 12], ['waitlist_claim_minutes', 30], ['waitlist_no_offer_hours', 2],
  ['rest_cap_hours', 6], ['group_min_players', 4], ['group_max_players', 6], ['package_expiry_reminder_days', [14, 3]], ['package_qr_minutes', 15],
  ['vat_enabled', false], ['resource_label', 'court'],
];
/** The checks a person or a feature records (kind 'recorded'); read from the producers so a new derived check never lands here by mistake. */
const recordedKeys = async (db: Querier): Promise<string[]> =>
  (await db.query(`select check_key from app.launch_producers where kind = 'recorded'`)).rows.map((r) => r['check_key'] as string);

/** Makes the facts behind every derived launch check true, for a club whose setup is complete (F01-T27b, migration 0046). */
async function satisfyDerivedChecks(db: Querier, club: string): Promise<void> {
  await db.query(`update public.club set receipt_prefix = 'HTC' where id = $1`, [club]);
  await db.query(`update public.line_connection set tested_at = coalesce(tested_at, app.now()) where club_id = $1`, [club]);
  for (const [k, v] of REQUIRED_SETTINGS) {
    await db.query(`insert into public.club_setting (club_id, key, value) values ($1, $2, $3::jsonb) on conflict (club_id, key) do update set value = excluded.value`, [club, k, JSON.stringify(v)]);
  }
  await db.query(`insert into platform.config (key, value) values ('pay_tap_limit_count', '5'), ('pay_tap_limit_window_seconds', '60') on conflict (key) do update set value = excluded.value`);
  // F10 (0610): the sender's retry values; the check exists on databases that carry 0610.
  await db.query(`insert into platform.config (key, value) values ('line_send_max_attempts', '3'), ('line_send_retry_seconds', '60') on conflict (key) do update set value = excluded.value`);
}
/** Makes the fact behind one derived check false again. */
async function breakDerived(db: Querier, club: string, key: string): Promise<void> {
  switch (key) {
    case 'line_test': await db.query(`update public.line_connection set tested_at = null where club_id = $1`, [club]); break;
    case 'receipt_prefix_set': await db.query(`update public.club set receipt_prefix = null where id = $1`, [club]); break;
    case 'pay_tap_limit_set': await db.query(`delete from platform.config where key like 'pay_tap_limit_%'`); break;
    case 'line_send_retry_set': await db.query(`delete from platform.config where key in ('line_send_max_attempts', 'line_send_retry_seconds')`); break;
    case 'template_required_settings': await db.query(`delete from public.club_setting where club_id = $1 and key = 'hold_minutes'`, [club]); break;
    default: throw new Error(`recordLaunchChecks cannot break ${key}`);
  }
}

/**
 * The one helper that makes a club pass Go live: every required launch check passes, whatever the configured list holds, so a new check
 * never breaks the lifecycle tests. Makes every required launch check pass, then makes the first checks (in list order) the given results: a recorded check
 * is written as that result, a derived check has its fact undone (so it reads pending). Returns the required keys.
 */
export async function recordLaunchChecks(db: Querier, club: string, first: string[] = []): Promise<string[]> {
  const keys = await requiredLaunchKeys(db);
  const recorded = await recordedKeys(db);
  await satisfyDerivedChecks(db, club);
  await db.query(`update public.payment_connection set merchant_id_live = 'm-live' where club_id = $1`, [club]);
  await db.query(
    `insert into platform.platform_staff (auth_user_id, email, display_name, role)
     select gen_random_uuid(), 'fixture-' || gen_random_uuid()::text || '@booq.example', 'Fixture', 'platform_admin'
      where not exists (select 1 from platform.platform_staff)`,
  );
  for (const kind of ['beam_api_key_live', 'beam_hmac_key_live']) {
    await db.query(
      `insert into public.club_secret (club_id, kind, ciphertext, key_id, written_by_staff)
       select $1, $2, 'booq1.x', 'k1', (select id from platform.platform_staff order by created_at limit 1) on conflict (club_id, kind) do nothing`,
      [club, kind],
    );
  }
  for (const [i, key] of keys.entries()) {
    const wanted = first[i] ?? 'pass';
    if (recorded.includes(key)) {
      await db.query(
        `insert into platform.launch_check (club_id, check_key, result) values ($1, $2, $3)
         on conflict (club_id, check_key) do update set result = excluded.result`,
        [club, key, wanted],
      );
    } else if (wanted !== 'pass') {
      await breakDerived(db, club, key);
    }
  }
  return keys;
}
