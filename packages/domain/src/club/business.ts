import { route, RouteError, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';
import { checkSettingWrite } from './settings-registry';

// PUT /club/business (F01 design 5.1, 5.14; ADMIN-16; D115). The owner changes the club's business and tax details, the ones a receipt
// shows (RCPT-02): the legal company name, the tax ID, the branch and the registered address, and the VAT switch. The receipt prefix is
// read only here (the numbering of receipts must not change under an issued sequence); a request that names it is refused. Nothing
// is supplied for the owner and a detail cannot be cleared by an empty value: a receipt needs them. The accountant reads these only
// (settings.business.read, GET /settings and GET /club); only the owner writes (club.business.write).
//
// The columns are the owner's to update by the database grant (migration 0002); the club's audit log gets the old and new value with the
// owner as actor (public.club is audited, migration 0005), and the VAT switch goes through the same registry check and the same row
// as PUT /settings/vat_enabled, so the two routes cannot disagree.

const TEXT_FIELDS = ['legal_name', 'tax_id', 'tax_branch', 'registered_address'] as const;
type TextField = (typeof TEXT_FIELDS)[number];
/** Most characters of each detail; the same limit as when BOOQ staff create the club, and a longer one for the address. */
const MAX: Record<TextField, number> = { legal_name: 200, tax_id: 200, tax_branch: 200, registered_address: 500 };
const TAX_ID = /^\d{13}$/;

interface Change {
  columns: Partial<Record<TextField, string>>;
  vat: boolean | undefined;
}

function parse(input: unknown): Change {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new RouteError(400, 'invalid_input');
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length === 0 || keys.some((k) => !(TEXT_FIELDS as readonly string[]).includes(k) && k !== 'vat_enabled')) throw new RouteError(400, 'invalid_input');
  const columns: Change['columns'] = {};
  for (const f of TEXT_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (typeof v !== 'string' || v.trim() === '' || v.trim().length > MAX[f]) throw new RouteError(400, 'invalid_input');
    const t = v.trim();
    if (f === 'tax_id' && !TAX_ID.test(t)) throw new RouteError(400, 'invalid_input');
    columns[f] = t;
  }
  if ('vat_enabled' in body && typeof body['vat_enabled'] !== 'boolean') throw new RouteError(400, 'invalid_input');
  return { columns, vat: typeof body['vat_enabled'] === 'boolean' ? body['vat_enabled'] : undefined };
}

export function businessRoute(db: Db) {
  return route({ method: 'PUT', path: '/club/business', permission: 'club.business.write' }, async (ctx: RouteContext) => {
    const change = parse(ctx.input);
    return db.withClubTx(
      { clubId: ctx.clubId, userId: ctx.userId, roles: ctx.roles, source: 'admin', ...(ctx.requestId ? { requestId: ctx.requestId } : {}) },
      async (tx) => {
        const cols = Object.keys(change.columns) as TextField[];
        if (cols.length > 0) {
          const r = await tx.query(`update public.club set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [ctx.clubId, ...cols.map((c) => change.columns[c])]);
          if (r.rowCount !== 1) throw new RouteError(404, 'not_found');
        }
        if (change.vat !== undefined) {
          const w = checkSettingWrite({ key: 'vat_enabled', value: change.vat, paymentOption: null, otherGroupLimit: undefined });
          if (!w.ok) throw new RouteError(w.status, w.code);
          if (w.action === 'set') {
            await tx.query(
              `insert into public.club_setting (club_id, key, value) values ($1, 'vat_enabled', $2::jsonb)
               on conflict (club_id, key) do update set value = excluded.value, updated_at = app.now()`,
              [ctx.clubId, JSON.stringify(w.value)],
            );
          }
        }
        const club = (await tx.query<Record<TextField, string | null>>('select legal_name, tax_id, tax_branch, registered_address from public.club_business where club_id = $1', [ctx.clubId])).rows[0]!; // the view: the app role may not read these columns of public.club (migration 0026)
        const vat = (await tx.query<{ value: unknown }>(`select value from public.club_setting where club_id = $1 and key = 'vat_enabled'`, [ctx.clubId])).rows[0]?.value ?? null;
        return { ...club, vat_enabled: vat };
      },
    );
  });
}
