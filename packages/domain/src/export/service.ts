import { toCsv, type CsvCell } from './csv';
import type { ExportStorage } from './storage';
import { createZip } from './zip';

// Club data export (F01-T32; PLAT-06-AC11 to AC17; D14). The owner starts or downloads it; BOOQ
// staff can only start one and never receive the file or the link. A worker task builds it inside
// the club's context, so every query is club scoped by row level security (AC11). Slips and staff
// notes are not exported (assumption A-15, until Q18 is decided). There is no delete-club function
// anywhere (AC17). Link life is a platform setting: 24 hours is assumption A-14.

export type ExportErrorCode = 'forbidden' | 'not_found' | 'expired';
export class ExportError extends Error {
  constructor(readonly code: ExportErrorCode) {
    super(code);
  }
}

export interface ExportTx {
  // Rows are untyped here: the caller's own transaction type fits this shape.
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ExportActor {
  clubId: string;
  userId: string | null;
  roles: readonly string[];
}
export type ExportKind = 'club' | 'customers';

/** One CSV file in the export. Later features add their own (bookings, ledgers ...) to the list. */
export interface ExportDataset {
  name: string;
  kinds: readonly ExportKind[];
  columns: readonly string[];
  /** A club scoped select returning the columns above, by those names. Dates and times as text. */
  sql: string;
}

export const f01Datasets: readonly ExportDataset[] = [
  {
    name: 'players',
    kinds: ['club', 'customers'],
    columns: ['id', 'full_name', 'phone', 'date_of_birth', 'language', 'level', 'claimed', 'created_at'],
    // Test accounts are not club data (D33). `claimed` is false for an imported record nobody has taken over.
    sql: `select id, full_name, phone, date_of_birth::text as date_of_birth, language, level, (line_user_id is not null) as claimed,
                 to_char(created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS') as created_at
            from public.app_user where not is_test order by created_at, id`,
  },
  {
    name: 'resources',
    kinds: ['club'],
    columns: ['id', 'location', 'name', 'sport', 'type', 'lights', 'max_players', 'active'],
    sql: `select r.id, l.name as location, r.name, r.sport, r.type, r.lights, r.max_players, r.active
            from public.resource r join public.location l on l.club_id = r.club_id and l.id = r.location_id order by l.name, r.name`,
  },
  {
    name: 'opening_hours',
    kinds: ['club'],
    columns: ['weekday', 'open', 'close'],
    sql: `select weekday, open::text as open, close::text as close from public.opening_hours order by weekday`,
  },
  {
    name: 'settings',
    kinds: ['club'],
    columns: ['key', 'value'],
    sql: `select key, value::text as value from public.club_setting order by key`,
  },
];

export interface ExportServiceOptions {
  storage: ExportStorage;
  /** Longest life of a link, in seconds (assumption A-14: 24 hours). Also the life of the file. */
  linkSeconds: number;
  datasets?: readonly ExportDataset[];
}

export interface ExportSummary {
  id: string;
  kind: ExportKind;
  status: string;
  rowCount: number | null;
  expiresAt: string | null;
  /** Present only for the owner, only when the file is ready and not expired. */
  link: string | null;
}

export function createExportService(options: ExportServiceOptions) {
  const datasets = options.datasets ?? f01Datasets;
  const requireOwner = (actor: ExportActor) => {
    if (!actor.roles.includes('owner')) throw new ExportError('forbidden');
  };

  return {
    /** The owner starts an export. The caller then enqueues the worker task with the returned id. */
    async start(tx: ExportTx, actor: ExportActor, input: { kind: ExportKind }): Promise<ExportSummary> {
      requireOwner(actor);
      const row = (
        await tx.query(`insert into public.data_export (club_id, kind, requested_by_user) values (app.club_id(), $1, $2) returning id, kind, status`, [input.kind, actor.userId])
      ).rows[0];
      return { id: row.id, kind: row.kind, status: row.status, rowCount: null, expiresAt: null, link: null };
    },

    /** The worker task, inside the club's context. Never throws for a build failure: it records `failed`. */
    async run(tx: ExportTx, exportId: string): Promise<void> {
      const job = (await tx.query(`select id, kind, status, club_id from public.data_export where id = $1 for update`, [exportId])).rows[0];
      if (!job || job.status !== 'requested') return; // unknown here, or already built
      await tx.query(`update public.data_export set status = 'running' where id = $1`, [exportId]);
      try {
        const files: { name: string; data: string }[] = [];
        let rows = 0;
        for (const d of datasets.filter((x) => x.kinds.includes(job.kind))) {
          const res = await tx.query(d.sql);
          rows += res.rows.length;
          files.push({ name: `${d.name}.csv`, data: toCsv(d.columns, res.rows.map((r) => d.columns.map((c) => r[c] as CsvCell))) });
        }
        const path = `${job.club_id}/${exportId}.zip`;
        await options.storage.put(path, createZip(files));
        await tx.query(`update public.data_export set status = 'done', storage_path = $2, row_count = $3, expires_at = app.now() + make_interval(secs => $4) where id = $1`, [
          exportId,
          path,
          rows,
          options.linkSeconds,
        ]);
      } catch {
        await tx.query(`update public.data_export set status = 'failed', storage_path = null where id = $1`, [exportId]);
      }
    },

    async get(tx: ExportTx, actor: ExportActor, exportId: string): Promise<ExportSummary> {
      requireOwner(actor);
      const row = (
        await tx.query(
          `select id, kind, status, row_count, storage_path, expires_at, expires_at <= app.now() as expired,
                  floor(extract(epoch from (expires_at - app.now())))::int as seconds_left
             from public.data_export where id = $1`,
          [exportId],
        )
      ).rows[0];
      if (!row) throw new ExportError('not_found');
      if (row.status === 'done' && row.expired) throw new ExportError('expired');
      const link =
        row.status === 'done' ? await options.storage.signedUrl(row.storage_path, Math.max(1, Math.min(options.linkSeconds, row.seconds_left))) : null;
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        rowCount: row.row_count,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        link,
      };
    },
  };
}
