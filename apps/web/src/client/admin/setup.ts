import { call, type Outcome } from './api';

// A0 Setup checklist (F11-T24; ADMIN-02; board H-A0-Setup-checklist), apart from the screen. GET /staff/setup gives steps 6 to 8 with their done
// state (derived from the club's own rows) and when the owner told BOOQ; POST /staff/setup/done tells BOOQ once. The CSV import of step 7 is
// POST /imports (kind, fileName, content), then confirm or cancel: nothing is saved until the owner confirms, and a file with any error saves
// nothing (all or nothing). Steps 1 to 5 are BOOQ's and step 9 is BOOQ's after the owner is done.

type Fetch = typeof fetch;

export type StepKey = 'brand' | 'products_rules' | 'people';
export interface OwnerSetup {
  clubStatus: string;
  steps: Array<{ key: StepKey; done: boolean }>;
  toldAt: string | null;
}
export const STEP_KEYS: ReadonlyArray<{ key: StepKey; no: number; titleKey: string; textKey: string | null; segment: string | null }> = [
  { key: 'brand', no: 6, titleKey: 'A-0495', textKey: null, segment: null },
  { key: 'products_rules', no: 7, titleKey: 'A-0497', textKey: 'A-0498', segment: 'pricing' },
  { key: 'people', no: 8, titleKey: 'A-0499', textKey: 'A-0500', segment: 'staff' },
];

export const loadSetup = (slug: string, f: Fetch) => call<OwnerSetup>(slug, '/staff/setup', f);
export const tellDone = (slug: string, f: Fetch) => call<{ recorded: boolean }>(slug, '/staff/setup/done', f, { method: 'POST', body: {} });

/** How many of steps 6 to 8 are still open. The button unlocks when none is (A-0504). */
export const stepsLeft = (s: OwnerSetup): number => s.steps.filter((x) => !x.done).length;
export const canTellDone = (s: OwnerSetup): boolean => stepsLeft(s) === 0 && s.toldAt === null && s.steps.length > 0;
/** The checklist is shown until the club is live (ADMIN-02). */
export const showsChecklist = (s: OwnerSetup): boolean => s.clubStatus !== 'live';

export interface ImportSummary {
  id: string;
  kind: string;
  status: string;
  rowsRead: number;
  rowsSaved: number;
  rowsRejected: number;
  fileErrors: string[];
  errors: Array<{ rowNo: number; codes: string[] }>;
  flags: Array<{ rowNo: number; flags: string[] }>;
}
export const startImport = (slug: string, fileName: string, content: string, f: Fetch): Promise<Outcome<ImportSummary>> => call<ImportSummary>(slug, '/imports', f, { method: 'POST', body: { kind: 'players', fileName, content } });
export const confirmImport = (slug: string, id: string, f: Fetch) => call<ImportSummary>(slug, `/imports/${encodeURIComponent(id)}/confirm`, f, { method: 'POST', body: {} });
export const cancelImport = (slug: string, id: string, f: Fetch) => call<ImportSummary>(slug, `/imports/${encodeURIComponent(id)}`, f, { method: 'DELETE' });

/** A file the owner picks is read as text, at most this big, before anything is sent (the server limits rows; this limits what the page holds). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const confirmable = (s: ImportSummary): boolean => s.status === 'validated' && s.rowsRejected === 0 && s.fileErrors.length === 0;

export const ROW_ERROR_KEY: Record<string, string> = {
  name_missing: 'A-new.import_err_name', phone_missing: 'A-new.import_err_phone_missing', phone_invalid: 'A-new.import_err_phone_invalid', dob_invalid: 'A-new.import_err_dob',
  dob_future: 'A-new.import_err_dob_future', row_width: 'A-new.import_err_width',
};
export const FILE_ERROR_KEY: Record<string, string> = { file_empty: 'A-new.import_file_empty', column_missing: 'A-new.import_file_column_missing', column_duplicate: 'A-new.import_file_column_duplicate' };
export const FLAG_KEY: Record<string, string> = { duplicate_phone: 'A-new.import_flag_duplicate_phone' };

/** The text key of a refusal of the import routes. */
export const IMPORT_ERROR_KEY: Record<string, string> = {
  import_not_configured: 'A-new.import_not_configured', kind_not_available: 'A-new.import_kind', too_many_rows: 'A-new.import_too_many', not_confirmable: 'A-new.import_not_confirmable',
  not_cancellable: 'A-new.import_not_confirmable', expired: 'A-new.import_expired', bad_input: 'A-new.import_bad',
};
export function importErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.import_forbidden';
  if (o.kind === 'not_found') return 'A-new.import_expired';
  if (o.kind === 'refused') return IMPORT_ERROR_KEY[o.code] ?? 'A-new.import_general';
  if (o.kind === 'offline') return 'A-new.import_general';
  return 'A-new.import_general';
}
