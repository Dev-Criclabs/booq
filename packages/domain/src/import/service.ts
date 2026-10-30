import { validatePlayersCsv } from './players';

// Import service (F01-T31; PLAT-06-AC1 to AC4, AC6, AC8, AC10, AC18; D13, D105, SR-05).
// Functions take the open club transaction, so the route decides the transaction boundary and
// every query is club scoped by row level security. Import is for the owner only; the database
// policies are the second layer. Only parsed values are staged (never the file or the raw cells),
// staging goes when the job is confirmed or cancelled (database trigger) or expires, and a file
// with any error is not confirmable (all or nothing). Packages and balances are registered by F06.

export type ImportErrorCode =
  | 'forbidden'
  | 'kind_not_available'
  | 'too_many_rows'
  | 'not_found'
  | 'not_confirmable'
  | 'not_cancellable'
  | 'expired';

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
  }
}

export interface ImportTx {
  // Rows are untyped here (any): the caller's own transaction type fits this shape.

  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ImportActor {
  clubId: string;
  userId: string | null;
  roles: readonly string[];
}
/** Platform configuration. No value is invented here: the caller supplies both. */
export interface ImportLimits {
  maxRows: number;
  stagingHours: number;
}

export interface ValidatedRow {
  rowNo: number;
  values: Record<string, unknown> | null;
  errors: string[];
  flags: string[];
}
export interface ValidatedFile {
  ok: boolean;
  rowsRead: number;
  rows: ValidatedRow[];
  fileErrors: string[];
}
export interface ImportHandler {
  validate(text: string, opts: { today: string; normalizePhone(raw: string): string | null }): ValidatedFile;
  /** Runs inside the confirm transaction. Returns the number of rows saved. Never creates bookings (AC18). */
  confirm(tx: ImportTx, rows: ValidatedRow[], actor: ImportActor): Promise<number>;
}

export interface ImportSummary {
  id: string;
  kind: string;
  status: string;
  rowsRead: number;
  rowsSaved: number;
  rowsRejected: number;
  fileErrors: string[];
  errors: { rowNo: number; codes: string[] }[];
  flags: { rowNo: number; flags: string[] }[];
}

/** Stored as digits only (migration 0101 check); the E.164 `+` is dropped. */
const storedPhone = (e164: string) => e164.replace(/^\+/, '');

const playersHandler: ImportHandler = {
  validate(text, opts) {
    const r = validatePlayersCsv(text, opts);
    return {
      ok: r.ok,
      rowsRead: r.rowsRead,
      fileErrors: r.fileErrors,
      rows: r.rows.map((x) => ({ rowNo: x.rowNo, values: x.values ? { ...x.values } : null, errors: x.errors, flags: x.flags })),
    };
  },
  async confirm(tx, rows) {
    const v = rows.map((r) => r.values as { fullName: string; phone: string; dateOfBirth: string | null });
    // Unclaimed: no LINE id, so nobody can sign in as them and nothing is spendable (D105). Every
    // person keeps the Player role (a database rule, D115). Staff confirm a claim later.
    const res = await tx.query(
      `with made as (
         insert into public.app_user (club_id, full_name, phone, phone_normalized, date_of_birth, claim_state)
         select app.club_id(), n, p, regexp_replace(p, '^\\+', ''), d, 'unclaimed'
           from unnest($1::text[], $2::text[], $3::date[]) as t(n, p, d)
         returning club_id, id)
       insert into public.app_user_role (club_id, user_id, role) select club_id, id, 'player' from made`,
      [v.map((x) => x.fullName), v.map((x) => x.phone), v.map((x) => x.dateOfBirth)],
    );
    return res.rowCount ?? 0;
  },
};

export interface ImportServiceOptions {
  limits: ImportLimits;
  /** Today's Asia/Bangkok date from the clock. */
  today(): string;
  normalizePhone(raw: string): string | null;
  /** Handlers for other kinds (F06 registers packages and balances). */
  handlers?: Record<string, ImportHandler>;
}

export function createImportService(options: ImportServiceOptions) {
  const handlers: Record<string, ImportHandler> = { players: playersHandler, ...(options.handlers ?? {}) };
  const requireOwner = (actor: ImportActor) => {
    if (!actor.roles.includes('owner')) throw new ImportError('forbidden');
  };
  const handlerFor = (kind: string) => {
    const h = Object.hasOwn(handlers, kind) ? handlers[kind] : undefined;
    if (!h) throw new ImportError('kind_not_available');
    return h;
  };

  async function summary(tx: ImportTx, id: string): Promise<ImportSummary> {
    const job = (
      await tx.query(
        'select id, kind, status, rows_read, rows_saved, rows_rejected from public.import_job where id = $1',
        [id],
      )
    ).rows[0];
    if (!job) throw new ImportError('not_found');
    const staged = (await tx.query('select row_no, raw, errors from public.import_row where job_id = $1 order by row_no', [id])).rows;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      rowsRead: job.rows_read,
      rowsSaved: job.rows_saved,
      rowsRejected: job.rows_rejected,
      fileErrors: [],
      errors: staged.filter((r) => r.errors.length).map((r) => ({ rowNo: r.row_no, codes: r.errors })),
      flags: staged.filter((r) => (r.raw.flags ?? []).length).map((r) => ({ rowNo: r.row_no, flags: r.raw.flags! })),
    };
  }

  return {
    async start(tx: ImportTx, actor: ImportActor, input: { kind: string; fileName: string; text: string }): Promise<ImportSummary> {
      requireOwner(actor);
      const handler = handlerFor(input.kind);
      const checked = handler.validate(input.text, { today: options.today(), normalizePhone: options.normalizePhone });
      if (checked.rows.length > options.limits.maxRows) throw new ImportError('too_many_rows');
      const rejected = checked.rows.filter((r) => r.errors.length > 0).length;
      const ok = checked.ok && checked.fileErrors.length === 0 && rejected === 0;
      const job = (
        await tx.query(
          `insert into public.import_job (club_id, kind, file_name, status, rows_read, rows_rejected, created_by, expires_at)
           values (app.club_id(), $1, $2, $3, $4, $5, $6, app.now() + make_interval(hours => $7)) returning id`,
          [input.kind, input.fileName, ok ? 'validated' : 'failed', checked.rowsRead, rejected, actor.userId, options.limits.stagingHours],
        )
      ).rows[0]!;
      for (const r of checked.rows) {
        // Parsed values only. A row with errors keeps its codes and nothing of what was typed.
        await tx.query('insert into public.import_row (club_id, job_id, row_no, raw, errors) values (app.club_id(), $1, $2, $3, $4)', [
          job.id,
          r.rowNo,
          JSON.stringify({ values: r.errors.length ? null : r.values, flags: r.flags }),
          JSON.stringify(r.errors),
        ]);
      }
      return { ...(await summary(tx, job.id)), fileErrors: checked.fileErrors };
    },

    async get(tx: ImportTx, actor: ImportActor, id: string): Promise<ImportSummary> {
      requireOwner(actor);
      return summary(tx, id);
    },

    async confirm(tx: ImportTx, actor: ImportActor, id: string): Promise<ImportSummary> {
      requireOwner(actor);
      const job = (
        await tx.query(
          'select kind, status, expires_at <= app.now() as expired from public.import_job where id = $1 for update',
          [id],
        )
      ).rows[0];
      if (!job) throw new ImportError('not_found');
      if (job.status !== 'validated') throw new ImportError('not_confirmable');
      if (job.expired) throw new ImportError('expired');
      const handler = handlerFor(job.kind);
      const staged = (await tx.query('select row_no, raw from public.import_row where job_id = $1 order by row_no', [id])).rows;
      const saved = await handler.confirm(
        tx,
        staged.map((r) => ({ rowNo: r.row_no, values: r.raw.values, errors: [], flags: r.raw.flags ?? [] })),
        actor,
      );
      await tx.query(`update public.import_job set status = 'confirmed', rows_saved = $2 where id = $1`, [id, saved]);
      return summary(tx, id);
    },

    async cancel(tx: ImportTx, actor: ImportActor, id: string): Promise<ImportSummary> {
      requireOwner(actor);
      const res = await tx.query(`update public.import_job set status = 'cancelled' where id = $1 and status in ('uploaded', 'validated', 'failed')`, [id]);
      if (!res.rowCount) {
        const exists = (await tx.query('select 1 from public.import_job where id = $1', [id])).rows.length > 0;
        throw new ImportError(exists ? 'not_cancellable' : 'not_found');
      }
      return summary(tx, id);
    },
  };
}
