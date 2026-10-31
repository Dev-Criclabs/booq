// Generic row seeding for the tenant suite (F01-T07). A superuser connection with session_replication_role = replica
// (triggers and foreign keys off) inserts one row per club into a table, filling only the columns the table requires.
// A table whose CHECK constraints reject the generic values needs a fixture in fixtures.ts; nothing is skipped silently.
/** What the seeder needs from a checked-out client (the pg package belongs to packages/db, not to the root). */
export interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

interface Col {
  column_name: string;
  data_type: string;
  udt_name: string;
  udt_schema: string;
  character_maximum_length: number | null;
}

const enumCache = new Map<string, string>();

async function firstEnumLabel(db: DbClient, udt: string): Promise<string> {
  let v = enumCache.get(udt);
  if (v === undefined) {
    const { rows } = await db.query(`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = $1 order by e.enumsortorder limit 1`, [udt]);
    if (!rows[0]) throw new Error(`no enum labels for type ${udt}`);
    v = rows[0].enumlabel as string;
    enumCache.set(udt, v);
  }
  return v;
}

/** A SQL expression that gives one acceptable, mostly unique value for the type. */
async function valueFor(db: DbClient, c: Col): Promise<string> {
  const len = c.character_maximum_length;
  switch (c.udt_name) {
    case 'uuid':
      return 'gen_random_uuid()';
    case 'text':
    case 'citext':
      return `'s-' || gen_random_uuid()::text`;
    case 'varchar':
    case 'bpchar':
      return len ? `substr('s' || md5(random()::text), 1, ${Math.min(len, 12)})` : `'s-' || gen_random_uuid()::text`;
    case 'int2':
      return `(1 + floor(random() * 100))::int2`;
    case 'int4':
      return `(1 + floor(random() * 1000000))::int4`;
    case 'int8':
      return `(1 + floor(random() * 1000000000))::int8`;
    case 'numeric':
      return `(1 + floor(random() * 1000))::numeric`;
    case 'float4':
    case 'float8':
      return '1';
    case 'bool':
      return 'false';
    case 'date':
      return 'current_date';
    case 'timestamptz':
      return 'now()';
    case 'timestamp':
      return 'localtimestamp';
    case 'time':
      return `'00:00'::time`;
    case 'timetz':
      return `'00:00+07'::timetz`;
    case 'jsonb':
    case 'json':
      return `'{}'::${c.udt_name}`;
    case 'bytea':
      return `'\\x00'::bytea`;
    case 'interval':
      return `'1 hour'::interval`;
    case 'inet':
      return `'127.0.0.1'::inet`;
    default:
      if (c.udt_name.startsWith('_')) return `'{}'::${c.udt_schema}.${c.udt_name}`;
      if (c.data_type === 'USER-DEFINED') {
        const label = await firstEnumLabel(db, c.udt_name);
        return `'${label.replace(/'/g, "''")}'::${c.udt_schema}.${c.udt_name}`;
      }
      throw new Error(`no generic value for type ${c.udt_schema}.${c.udt_name} (column ${c.column_name})`);
  }
}

export type Fixture = (db: DbClient, clubId: string) => Promise<void>;

/** Tables the generic seeder cannot fill. Each needs a reason and a fixture that inserts one row for the club. */
export const FIXTURES: Record<string, { reason: string; seed: Fixture }> = {};

export async function seedRow(db: DbClient, table: string, clubId: string): Promise<void> {
  const fixture = FIXTURES[table];
  if (fixture) return fixture.seed(db, clubId);
  const [schema, name] = table.split('.') as [string, string];
  const { rows: cols }: { rows: Array<Col & { is_nullable: string; column_default: string | null; is_identity: string; is_generated: string }> } = await db.query(
    `select column_name, data_type, udt_name, udt_schema, character_maximum_length, is_nullable, column_default, is_identity, is_generated
       from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position`,
    [schema, name],
  );
  const names: string[] = [];
  const values: string[] = [];
  for (const c of cols) {
    if (c.column_name === 'club_id') {
      names.push('club_id');
      values.push(`'${clubId}'`);
      continue;
    }
    const required = c.is_nullable === 'NO' && c.column_default === null && c.is_identity === 'NO' && c.is_generated === 'NEVER';
    if (!required) continue;
    names.push(`"${c.column_name}"`);
    values.push(await valueFor(db, c));
  }
  if (!names.includes('club_id')) throw new Error(`${table} has no club_id column`);
  await db.query(`insert into ${schema}."${name}" (${names.join(', ')}) values (${values.join(', ')})`);
}
