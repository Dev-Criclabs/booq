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
}

export async function requiredLaunchKeys(db: Querier): Promise<string[]> {
  const r = await db.query(`select value from platform.config where key = 'required_launch_checks'`);
  return (r.rows[0]?.['value'] as Array<{ key: string }>).map((x) => x.key);
}

/** Records a result for the first required checks (in order), and a pass for all the others. */
export async function recordLaunchChecks(db: Querier, club: string, first: string[] = []): Promise<string[]> {
  const keys = await requiredLaunchKeys(db);
  for (const [i, key] of keys.entries()) {
    await db.query(
      `insert into platform.launch_check (club_id, check_key, result) values ($1, $2, $3)
       on conflict (club_id, check_key) do update set result = excluded.result`,
      [club, key, first[i] ?? 'pass'],
    );
  }
  return keys;
}
