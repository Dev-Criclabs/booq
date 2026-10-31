import type { Tx } from '../../../db/src/tx';
import { AdminError } from './errors';

// F04-T14 / F11 A9, A9b, A10 (ADMIN-10, 11, 12; R3-AC8, PROMO-01-AC12): the owner's setup data, one small set of routes per table:
// price groups, court price rules, coach tiers and their prices, add-ons, partners and promo codes. The owner writes through the tables'
// own row policies (owner only; the club filter is restrictive), and every write is audited by the table's trigger. A change applies to new
// orders only: orders keep copies of what they were priced with, so nothing here touches an order. A price left out or sent as null is
// "not set" and is never replaced by a default. Deleting something an order, a package or a code still points at is refused (in_use).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Kind = 'text' | 'int' | 'bool' | 'uuid' | 'date' | 'textarray' | 'rule' | { enum: readonly string[] };
interface Field {
  /** The name in the request and the answer. */
  key: string;
  column: string;
  kind: Kind;
  /** Required when created. */
  required?: boolean;
  /** May be sent as null. */
  nullable?: boolean;
  /** An integer must be at least this. */
  min?: number;
  max?: number;
  /** Text is changed with this before it is checked (a code is upper case). */
  upper?: boolean;
  /** The value used when a create leaves it out. Only for a column with no database default; never a price or a limit. */
  fallback?: unknown;
  /** Values the table allows but the rules do not define yet: refused with peak_not_defined. */
  notDefined?: readonly string[];
}
export interface SetupResource {
  path: string;
  table: string;
  fields: Field[];
  order: string;
  /** A product is switched off, never deleted: the table grants the app no delete (package products). */
  noDelete?: boolean;
  /** A read only count shown in the list: its answer key and the select expression (promo codes: how many orders used the code). */
  count?: { key: string; sql: string };
}

const bad = (field?: string): never => {
  throw new AdminError('bad_input', field ? { field } : {});
};

function clean(f: Field, v: unknown): unknown {
  if (v === null) {
    if (!f.nullable) bad(f.key);
    return null;
  }
  switch (f.kind) {
    case 'text': {
      if (typeof v !== 'string') return bad(f.key);
      const t = f.upper ? v.trim().toUpperCase() : v.trim();
      if (t === '' || t.length > 200) return bad(f.key);
      return t;
    }
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) return bad(f.key);
      return v;
    case 'bool':
      return typeof v === 'boolean' ? v : bad(f.key);
    case 'uuid':
      return typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad(f.key);
    case 'date':
      return typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : bad(f.key);
    case 'textarray':
      return Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((x) => typeof x === 'string' && x !== '') ? v : bad(f.key);
    case 'rule': {
      // {min_age?, max_age?}: whole ages, at least one of them (the table's check holds the order).
      if (typeof v !== 'object' || Array.isArray(v)) return bad(f.key);
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 0 || keys.some((k) => k !== 'min_age' && k !== 'max_age') || keys.some((k) => !Number.isInteger(o[k]) || (o[k] as number) < 0 || (o[k] as number) > 150)) return bad(f.key);
      return JSON.stringify(o);
    }
    default:
      if (typeof v === 'string' && f.notDefined?.includes(v)) throw new AdminError('peak_not_defined', { field: f.key });
      return typeof v === 'string' && (f.kind as { enum: readonly string[] }).enum.includes(v) ? v : bad(f.key);
  }
}

const NAMES: Field[] = [
  { key: 'nameTh', column: 'name_th', kind: 'text', required: true },
  { key: 'nameEn', column: 'name_en', kind: 'text', required: true },
];

export const SETUP: Record<string, SetupResource> = {
  'price-groups': {
    path: 'price-groups', table: 'price_group', order: 'position, name_en, id',
    fields: [...NAMES, { key: 'rule', column: 'rule', kind: 'rule', required: true }, { key: 'position', column: 'position', kind: 'int', min: 0, max: 1000, fallback: 0 }],
  },
  'court-prices': {
    path: 'court-prices', table: 'court_price_rule', order: 'price_group_id, day_type, id',
    fields: [
      { key: 'priceGroupId', column: 'price_group_id', kind: 'uuid', required: true },
      { key: 'dayType', column: 'day_type', kind: { enum: ['any', 'weekday', 'weekend'] }, fallback: 'any' },
      // Peak and off peak have no definition in v1 (F04 assumption A-4): the price lookup rejects them, so a rule for them is not saved
      // (peak_not_defined, see clean).
      { key: 'peak', column: 'peak', kind: { enum: ['any'] }, fallback: 'any', notDefined: ['peak', 'off_peak'] },
      { key: 'priceSatang', column: 'price_satang', kind: 'int', required: true, min: 0, max: 100_000_000 },
    ],
  },
  'coach-tiers': { path: 'coach-tiers', table: 'coach_tier', order: 'name_en, id', fields: NAMES },
  'add-ons': {
    path: 'add-ons', table: 'add_on', order: 'position, name_en, id',
    fields: [
      ...NAMES,
      { key: 'priceSatang', column: 'price_satang', kind: 'int', nullable: true, min: 0, max: 100_000_000 },
      { key: 'active', column: 'active', kind: 'bool', fallback: true },
      { key: 'position', column: 'position', kind: 'int', min: 0, max: 1000, fallback: 0 },
    ],
  },
  // F06 PKG-02: a package product. The database's checks hold the pairs (a solo pack names a coach tier, solo and group packs a price group).
  // Price and validity are copied onto each package sold, so a change here never alters packages already sold (PKG-02-AC4).
  'package-products': {
    path: 'package-products', table: 'package_product', order: 'credit_type, credits, id', noDelete: true,
    fields: [
      ...NAMES,
      { key: 'creditType', column: 'credit_type', kind: { enum: ['court_hour', 'solo_class', 'group_session'] }, required: true },
      { key: 'credits', column: 'credits', kind: 'int', required: true, min: 1, max: 1000 },
      { key: 'validityMonths', column: 'validity_months', kind: 'int', required: true, min: 1, max: 120 },
      { key: 'priceGroupId', column: 'price_group_id', kind: 'uuid', nullable: true },
      { key: 'coachTierId', column: 'coach_tier_id', kind: 'uuid', nullable: true },
      { key: 'priceSatang', column: 'price_satang', kind: 'int', nullable: true, min: 0, max: 100_000_000 },
      { key: 'active', column: 'active', kind: 'bool', fallback: true },
    ],
  },
  partners: {
    path: 'partners', table: 'partner', order: 'name, id',
    fields: [
      { key: 'name', column: 'name', kind: 'text', required: true },
      { key: 'type', column: 'type', kind: 'text', nullable: true },
      { key: 'contact', column: 'contact', kind: 'text', nullable: true },
    ],
  },
  'promo-codes': {
    path: 'promo-codes', table: 'promo_code', order: 'code_upper, id',
    count: { key: 'usedCount', sql: "(select count(*)::int from public.promo_redemption r where r.club_id = promo_code.club_id and r.code_id = promo_code.id and r.status = 'counted')" },
    fields: [
      { key: 'code', column: 'code_upper', kind: 'text', required: true, upper: true },
      { key: 'kind', column: 'kind', kind: { enum: ['percent', 'fixed'] }, required: true },
      { key: 'value', column: 'value', kind: 'int', required: true, min: 1, max: 100_000_000 },
      { key: 'appliesTo', column: 'applies_to', kind: 'textarray', required: true },
      { key: 'includesAddOns', column: 'includes_add_ons', kind: 'bool', fallback: false },
      { key: 'audience', column: 'audience', kind: { enum: ['adult', 'student', 'any'] }, fallback: 'any' },
      { key: 'startsOn', column: 'starts_on', kind: 'date', nullable: true },
      { key: 'endsOn', column: 'ends_on', kind: 'date', nullable: true },
      { key: 'firstTimeOnly', column: 'first_time_only', kind: 'bool', fallback: false },
      { key: 'totalCap', column: 'total_cap', kind: 'int', nullable: true, min: 1 },
      { key: 'perCustomerCap', column: 'per_customer_cap', kind: 'int', nullable: true, min: 1 },
      { key: 'minSpendSatang', column: 'min_spend_satang', kind: 'int', nullable: true, min: 0 },
      { key: 'stackableWithBirthday', column: 'stackable_with_birthday', kind: 'bool', fallback: false },
      { key: 'partnerId', column: 'partner_id', kind: 'uuid', nullable: true },
      { key: 'active', column: 'active', kind: 'bool', fallback: true },
    ],
  },
};

function shape(r: SetupResource, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row['id'] };
  for (const f of r.fields) {
    const v = row[f.column];
    out[f.key] = f.kind === 'date' && v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null);
  }
  if (r.count) out[r.count.key] = Number(row['used_count'] ?? 0);
  return out;
}

const cols = (r: SetupResource) =>
  ['id', ...r.fields.map((f) => (f.kind === 'date' ? `to_char(${f.column}, 'YYYY-MM-DD') as ${f.column}` : f.column)), ...(r.count ? [`${r.count.sql} as used_count`] : [])].join(', ');

function rowId(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new AdminError('not_found');
  return v.toLowerCase();
}

/** GET /staff/setup/<resource>: every row, ordered; the policies decide who sees which rows. */
export async function listSetup(tx: Tx, r: SetupResource): Promise<Record<string, unknown>[]> {
  const res = await tx.query(`select ${cols(r)} from public.${r.table} order by ${r.order}`);
  return res.rows.map((x) => shape(r, x));
}

function bodyObject(b: unknown, r: SetupResource): Record<string, unknown> {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return bad();
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !r.fields.some((f) => f.key === k))) return bad();
  return o;
}

/** POST /staff/setup/<resource>: only the fields sent are written; the others take the table's default (an unset price stays null). */
export async function createSetup(tx: Tx, r: SetupResource, body: unknown): Promise<Record<string, unknown>> {
  const o = bodyObject(body, r);
  const names: string[] = [];
  const values: unknown[] = [];
  for (const f of r.fields) {
    let v = o[f.key];
    if (v === undefined) {
      if (f.required) bad(f.key);
      if (f.fallback === undefined) continue;
      v = f.fallback;
    }
    names.push(f.column);
    values.push(clean(f, v));
  }
  const ins = await tx.query<Record<string, unknown>>(
    `insert into public.${r.table} (club_id, ${names.join(', ')}) values (app.club_id(), ${values.map((_, i) => `$${i + 1}`).join(', ')}) returning ${cols(r)}`, values);
  return shape(r, ins.rows[0]!);
}

/** PUT /staff/setup/<resource>/:id: changes the fields sent. */
export async function updateSetup(tx: Tx, r: SetupResource, id: unknown, body: unknown): Promise<Record<string, unknown>> {
  const rid = rowId(id);
  const o = bodyObject(body, r);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const f of r.fields) {
    if (o[f.key] === undefined) continue;
    values.push(clean(f, o[f.key]));
    sets.push(`${f.column} = $${values.length}`);
  }
  if (sets.length === 0) return bad();
  values.push(rid);
  const upd = await tx.query<Record<string, unknown>>(`update public.${r.table} set ${sets.join(', ')} where id = $${values.length} returning ${cols(r)}`, values);
  if (!upd.rows[0]) throw new AdminError('not_found');
  return shape(r, upd.rows[0]);
}

/** DELETE /staff/setup/<resource>/:id: refused with in_use while anything still points at the row. */
export async function deleteSetup(tx: Tx, r: SetupResource, id: unknown): Promise<{ ok: true }> {
  const del = await tx.query(`delete from public.${r.table} where id = $1 returning id`, [rowId(id)]);
  if (!del.rows[0]) throw new AdminError('not_found');
  return { ok: true };
}

// ---- coach tier prices: keyed by the tier and the price group, not by an id ------------------------------------------------------

export interface TierPrice {
  tierId: string;
  priceGroupId: string;
  priceSatang: number | null;
}

/** GET /staff/setup/coach-tier-prices */
export async function listTierPrices(tx: Tx): Promise<TierPrice[]> {
  const r = await tx.query(`select tier_id, price_group_id, price_satang from public.coach_tier_price order by tier_id, price_group_id`);
  return r.rows.map((x) => ({ tierId: x.tier_id, priceGroupId: x.price_group_id, priceSatang: x.price_satang ?? null }));
}

/** PUT /staff/setup/coach-tier-prices {tierId, priceGroupId, priceSatang|null}: sets or clears one price (null = not set, the coach cannot be picked). */
export async function putTierPrice(tx: Tx, body: unknown): Promise<TierPrice> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return bad();
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['tierId', 'priceGroupId', 'priceSatang'].includes(k))) return bad();
  const tier = clean({ key: 'tierId', column: '', kind: 'uuid' }, o['tierId']) as string;
  const group = clean({ key: 'priceGroupId', column: '', kind: 'uuid' }, o['priceGroupId']) as string;
  const price = o['priceSatang'] === undefined ? bad('priceSatang') : (clean({ key: 'priceSatang', column: '', kind: 'int', nullable: true, min: 0, max: 100_000_000 }, o['priceSatang']) as number | null);
  await tx.query(
    `insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values (app.club_id(), $1, $2, $3)
     on conflict (club_id, tier_id, price_group_id) do update set price_satang = excluded.price_satang`, [tier, group, price]);
  return { tierId: tier, priceGroupId: group, priceSatang: price };
}
