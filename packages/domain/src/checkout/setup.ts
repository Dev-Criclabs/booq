import type { Tx } from '../../../db/src/tx';

// F04-T14: the owner's setup of prices and codes (design 5.3; R3-AC8, PROMO-01-AC12; screens A9, A9b, A10 are F11's).
// GET lists, POST creates, PUT changes. Writes go through the club transaction as the owner, so the row policies of
// 0301 and 0302 decide who may write (price.write, owner) and the audit triggers registered there record the old and
// new values of every write. A change applies to new orders only: orders and their lines hold copies of the prices and
// names (R7-AC2). There is no delete: a price a held or paid order used stays, and a row is retired by its own field
// (add-on and code `active`, an empty price). Nothing here invents a value: a missing field is a refusal, or the
// table's own default.
//   * Court prices: a rule with `peak` or `off_peak` is refused (peak_not_defined), as the lookup refuses one (A-4).

export type SetupErrorCode = 'bad_input' | 'not_found' | 'duplicate' | 'peak_not_defined';

/** The locale key each refusal shows (pending, locales/pending/f04.json). */
export const SETUP_TEXT_KEYS: Record<SetupErrorCode, string> = {
  bad_input: 'A-new.setup_bad_input',
  not_found: 'A-new.setup_not_found',
  duplicate: 'A-new.setup_duplicate',
  peak_not_defined: 'A-new.setup_peak_not_defined',
};

export class SetupError extends Error {
  constructor(readonly code: SetupErrorCode) {
    super(code);
  }
}

type Parse = (v: unknown) => unknown;
interface Field {
  column: string;
  parse: Parse;
  /** Must be sent on create (no table default stands in for it). */
  required?: boolean;
}

const bad = (): never => {
  throw new SetupError('bad_input');
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;

const text: Parse = (v) => (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT ? v.trim() : bad());
const textOrNull: Parse = (v) => (v === null ? null : text(v));
const satang: Parse = (v) => (Number.isSafeInteger(v) && (v as number) >= 0 ? v : bad());
const satangOrNull: Parse = (v) => (v === null ? null : satang(v));
const count: Parse = (v) => (Number.isSafeInteger(v) && (v as number) > 0 ? v : bad());
const countOrNull: Parse = (v) => (v === null ? null : count(v));
const position: Parse = (v) => (Number.isSafeInteger(v) && (v as number) >= 0 ? v : bad());
const bool: Parse = (v) => (typeof v === 'boolean' ? v : bad());
const id: Parse = (v) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : bad());
const idOrNull: Parse = (v) => (v === null ? null : id(v));
const dateOrNull: Parse = (v) => (v === null ? null : typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : bad());
const oneOf = (...values: string[]): Parse => (v) => (typeof v === 'string' && values.includes(v) ? v : bad());
const LINE_SCOPES = ['court_hour', 'coach', 'add_on', 'package', 'solo_class', 'group_class'];
const scopes: Parse = (v) =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && LINE_SCOPES.includes(x)) ? [...new Set(v as string[])] : bad();
const codeText: Parse = (v) => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(s) ? s : bad();
};
// A court price rule names a peak only once peak is defined (A-4).
const peak: Parse = (v) => (v === 'any' ? v : v === 'peak' || v === 'off_peak' ? (() => { throw new SetupError('peak_not_defined'); })() : bad());

interface Resource {
  table: string;
  fields: Record<string, Field>;
  /** The JSON shape of a row (column -> JSON name, plus composed values). */
  select: string;
  /** Compose columns from several fields (the price group rule). */
  compose?: (b: Record<string, unknown>, partial: boolean, current?: Record<string, unknown>) => Record<string, unknown>;
  order: string;
}

const ageOrNull: Parse = (v) => (v === null ? null : Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 150 ? v : bad());

export const SETUP_RESOURCES = {
  'price-groups': {
    table: 'price_group',
    fields: {
      nameTh: { column: 'name_th', parse: text, required: true },
      nameEn: { column: 'name_en', parse: text, required: true },
      position: { column: 'position', parse: position },
    },
    compose: (b, partial, current) => {
      if (partial && b['minAge'] === undefined && b['maxAge'] === undefined) return {};
      const cur = (current?.['rule'] ?? {}) as Record<string, number | null>;
      const min = b['minAge'] !== undefined ? ageOrNull(b['minAge']) : partial ? (cur['min_age'] ?? null) : null;
      const max = b['maxAge'] !== undefined ? ageOrNull(b['maxAge']) : partial ? (cur['max_age'] ?? null) : null;
      if (min === null && max === null) bad();
      if (min !== null && max !== null && (min as number) > (max as number)) bad();
      const rule: Record<string, unknown> = {};
      if (min !== null) rule['min_age'] = min;
      if (max !== null) rule['max_age'] = max;
      return { rule: JSON.stringify(rule) };
    },
    select: `id, name_th as "nameTh", name_en as "nameEn", (rule ->> 'min_age')::int as "minAge", (rule ->> 'max_age')::int as "maxAge", position, rule`,
    order: 'position, name_en, id',
  },
  'court-prices': {
    table: 'court_price_rule',
    fields: {
      priceGroupId: { column: 'price_group_id', parse: id, required: true },
      dayType: { column: 'day_type', parse: oneOf('any', 'weekday', 'weekend') },
      peak: { column: 'peak', parse: peak },
      priceSatang: { column: 'price_satang', parse: satang, required: true },
    },
    select: `id, price_group_id as "priceGroupId", day_type as "dayType", peak, price_satang as "priceSatang"`,
    order: 'price_group_id, day_type, peak, id',
  },
  'add-ons': {
    table: 'add_on',
    fields: {
      nameTh: { column: 'name_th', parse: text, required: true },
      nameEn: { column: 'name_en', parse: text, required: true },
      priceSatang: { column: 'price_satang', parse: satangOrNull, required: true },
      active: { column: 'active', parse: bool },
      position: { column: 'position', parse: position },
    },
    select: `id, name_th as "nameTh", name_en as "nameEn", price_satang as "priceSatang", active, position`,
    order: 'position, name_en, id',
  },
  partners: {
    table: 'partner',
    fields: {
      name: { column: 'name', parse: text, required: true },
      type: { column: 'type', parse: textOrNull },
      contact: { column: 'contact', parse: textOrNull },
    },
    select: `id, name, type, contact`,
    order: 'name, id',
  },
  'promo-codes': {
    table: 'promo_code',
    fields: {
      code: { column: 'code_upper', parse: codeText, required: true },
      kind: { column: 'kind', parse: oneOf('percent', 'fixed'), required: true },
      value: { column: 'value', parse: count, required: true },
      appliesTo: { column: 'applies_to', parse: scopes, required: true },
      includesAddOns: { column: 'includes_add_ons', parse: bool },
      audience: { column: 'audience', parse: oneOf('adult', 'student', 'any') },
      startsOn: { column: 'starts_on', parse: dateOrNull },
      endsOn: { column: 'ends_on', parse: dateOrNull },
      firstTimeOnly: { column: 'first_time_only', parse: bool },
      totalCap: { column: 'total_cap', parse: countOrNull },
      perCustomerCap: { column: 'per_customer_cap', parse: countOrNull },
      minSpendSatang: { column: 'min_spend_satang', parse: satangOrNull },
      stackableWithBirthday: { column: 'stackable_with_birthday', parse: bool },
      partnerId: { column: 'partner_id', parse: idOrNull },
      active: { column: 'active', parse: bool },
    },
    select: `id, code_upper as code, kind, value, applies_to as "appliesTo", includes_add_ons as "includesAddOns", audience,
             starts_on::text as "startsOn", ends_on::text as "endsOn", first_time_only as "firstTimeOnly", total_cap as "totalCap",
             per_customer_cap as "perCustomerCap", min_spend_satang as "minSpendSatang", stackable_with_birthday as "stackableWithBirthday",
             partner_id as "partnerId", active`,
    order: 'code_upper, id',
  },
} satisfies Record<string, Resource>;

export type SetupResourceName = keyof typeof SETUP_RESOURCES;

function columnsOf(r: Resource, body: unknown, partial: boolean, current?: Record<string, unknown>): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) bad();
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(r.fields)) {
    if (b[name] === undefined) {
      if (!partial && f.required) bad();
      continue;
    }
    out[f.column] = f.parse(b[name]);
  }
  Object.assign(out, r.compose?.(b, partial, current) ?? {});
  return out;
}

function refused(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23505') throw new SetupError('duplicate');
  // A group, tier or partner of another club (or none), a CHECK of the table, a bad cast.
  if (code === '23503' || code === '23514' || code === '22P02' || code === '22007' || code === '22008') throw new SetupError('bad_input');
  throw e;
}

const shape = (row: Record<string, unknown>) => {
  const { rule: _rule, ...rest } = row;
  return rest;
};

export async function listSetup(tx: Tx, name: SetupResourceName): Promise<unknown[]> {
  const r: Resource = SETUP_RESOURCES[name];
  return (await tx.query<Record<string, unknown>>(`select ${r.select} from public.${r.table} where club_id = app.club_id() order by ${r.order}`)).rows.map(shape);
}

export async function createSetup(tx: Tx, name: SetupResourceName, body: unknown): Promise<unknown> {
  const r: Resource = SETUP_RESOURCES[name];
  const cols = columnsOf(r, body, false);
  const keys = Object.keys(cols);
  try {
    await tx.query('savepoint setup_write');
    const row = (await tx.query<Record<string, unknown>>(
      `insert into public.${r.table} (club_id, ${keys.join(', ')}) values (app.club_id(), ${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning ${r.select}`,
      keys.map((k) => cols[k]),
    )).rows[0]!;
    await tx.query('release savepoint setup_write');
    return shape(row);
  } catch (e) {
    await tx.query('rollback to savepoint setup_write');
    return refused(e);
  }
}

export async function updateSetup(tx: Tx, name: SetupResourceName, rowId: unknown, body: unknown): Promise<unknown> {
  const r: Resource = SETUP_RESOURCES[name];
  if (typeof rowId !== 'string' || !UUID.test(rowId)) throw new SetupError('not_found');
  const current = (await tx.query<Record<string, unknown>>(`select ${r.select} from public.${r.table} where club_id = app.club_id() and id = $1 for update`, [rowId])).rows[0];
  if (!current) throw new SetupError('not_found');
  const cols = columnsOf(r, body, true, current);
  const keys = Object.keys(cols);
  if (keys.length === 0) bad();
  try {
    await tx.query('savepoint setup_write');
    const row = (await tx.query<Record<string, unknown>>(
      `update public.${r.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where club_id = app.club_id() and id = $1 returning ${r.select}`,
      [rowId, ...keys.map((k) => cols[k])],
    )).rows[0];
    await tx.query('release savepoint setup_write');
    if (!row) throw new SetupError('not_found');
    return shape(row);
  } catch (e) {
    if (e instanceof SetupError) throw e;
    await tx.query('rollback to savepoint setup_write');
    return refused(e);
  }
}

// Coach tier prices are keyed by tier and price group (no id): GET lists them, POST and PUT set one, a null price
// meaning not set (R2-AC3).
export async function listCoachTierPrices(tx: Tx): Promise<unknown[]> {
  return (await tx.query(
    `select tier_id as "tierId", price_group_id as "priceGroupId", price_satang as "priceSatang"
       from public.coach_tier_price where club_id = app.club_id() order by tier_id, price_group_id`,
  )).rows;
}

export async function setCoachTierPrice(tx: Tx, body: unknown): Promise<unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) bad();
  const b = body as Record<string, unknown>;
  if (b['priceSatang'] === undefined) bad();
  const tier = id(b['tierId']);
  const group = id(b['priceGroupId']);
  const price = satangOrNull(b['priceSatang']);
  try {
    await tx.query('savepoint setup_write');
    const row = (await tx.query(
      `insert into public.coach_tier_price (club_id, tier_id, price_group_id, price_satang) values (app.club_id(), $1, $2, $3)
       on conflict (club_id, tier_id, price_group_id) do update set price_satang = excluded.price_satang
       returning tier_id as "tierId", price_group_id as "priceGroupId", price_satang as "priceSatang"`,
      [tier, group, price],
    )).rows[0];
    await tx.query('release savepoint setup_write');
    return row;
  } catch (e) {
    await tx.query('rollback to savepoint setup_write');
    return refused(e);
  }
}
