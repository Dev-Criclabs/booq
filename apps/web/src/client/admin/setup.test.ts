import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { canTellDone, confirmable, FILE_ERROR_KEY, FLAG_KEY, IMPORT_ERROR_KEY, importErrorKey, ROW_ERROR_KEY, showsChecklist, startImport, STEP_KEYS, stepsLeft, type ImportSummary, type OwnerSetup } from './setup';

// F11-T24 A0 Setup checklist (ADMIN-02).
const setup = (done: boolean[], over: Partial<OwnerSetup> = {}): OwnerSetup => ({ clubStatus: 'testing', steps: [{ key: 'brand', done: done[0]! }, { key: 'products_rules', done: done[1]! }, { key: 'people', done: done[2]! }], toldAt: null, ...over });
const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({ id: 'i1', kind: 'players', status: 'validated', rowsRead: 3, rowsSaved: 0, rowsRejected: 0, fileErrors: [], errors: [], flags: [], ...over });

describe('the checklist', () => {
  it('counts the steps left; Tell BOOQ unlocks only when steps 6 to 8 are all done and it has not been told', () => {
    expect(stepsLeft(setup([true, false, false]))).toBe(2);
    expect(canTellDone(setup([true, true, false]))).toBe(false);
    expect(canTellDone(setup([true, true, true]))).toBe(true);
    expect(canTellDone(setup([true, true, true], { toldAt: '2027-01-01T03:00:00Z' }))).toBe(false);
    expect(canTellDone({ clubStatus: 'draft', steps: [], toldAt: null })).toBe(false);
  });
  it('the checklist stays until the club is live; there are exactly steps 6, 7 and 8', () => {
    expect(showsChecklist(setup([false, false, false], { clubStatus: 'draft' }))).toBe(true);
    expect(showsChecklist(setup([true, true, true], { clubStatus: 'paused' }))).toBe(true);
    expect(showsChecklist(setup([true, true, true], { clubStatus: 'live' }))).toBe(false);
    expect(STEP_KEYS.map((s) => s.no)).toEqual([6, 7, 8]);
  });
});

describe('the import', () => {
  it('a file is confirmable only when it was validated with no rejected row and no file error (all or nothing)', () => {
    expect(confirmable(summary())).toBe(true);
    expect(confirmable(summary({ rowsRejected: 1 }))).toBe(false);
    expect(confirmable(summary({ fileErrors: ['column_missing'] }))).toBe(false);
    expect(confirmable(summary({ status: 'failed' }))).toBe(false);
    expect(confirmable(summary({ status: 'confirmed' }))).toBe(false);
  });
  it('starts a players import with the file name and its text', async () => {
    let sent: unknown;
    const f = (async (url: string, init: { body: string }) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify(summary()), { status: 200 }); }) as unknown as typeof fetch;
    expect(await startImport('hunter', 'players.csv', 'full_name,phone\nA,081', f)).toMatchObject({ kind: 'ok' });
    expect(sent).toEqual({ url: '/api/c/hunter/imports', body: { kind: 'players', fileName: 'players.csv', content: 'full_name,phone\nA,081' } });
  });
  it('each refusal has its own words, the rest the general one', () => {
    expect(importErrorKey({ kind: 'refused', status: 503, code: 'import_not_configured' })).toBe('A-new.import_not_configured');
    expect(importErrorKey({ kind: 'refused', status: 413, code: 'too_many_rows' })).toBe('A-new.import_too_many');
    expect(importErrorKey({ kind: 'refused', status: 410, code: 'expired' })).toBe('A-new.import_expired');
    expect(importErrorKey({ kind: 'forbidden' })).toBe('A-new.import_forbidden');
    expect(importErrorKey({ kind: 'refused', status: 400, code: 'new_code' })).toBe('A-new.import_general');
    expect(importErrorKey({ kind: 'offline' })).toBe('A-new.import_general');
  });
});

describe('text', () => {
  it('every key the page uses exists in both languages', () => {
    const keys = ['A-0488', 'A-0490', 'A-0491', 'A-0492', 'A-0493', 'A-0494', 'A-0495', 'A-0497', 'A-0498', 'A-0499', 'A-0500', 'A-0501', 'A-0502', 'A-0503', 'A-0504',
      ...STEP_KEYS.map((s) => s.titleKey), ...Object.values(ROW_ERROR_KEY), ...Object.values(FILE_ERROR_KEY), ...Object.values(FLAG_KEY), ...Object.values(IMPORT_ERROR_KEY),
      'A-new.setup_done', 'A-new.setup_open', 'A-new.setup_told', 'A-new.setup_brand_note', 'A-new.setup_go_pricing', 'A-new.setup_go_staff', 'A-new.setup_load_failed', 'A-new.setup_forbidden', 'A-new.setup_live', 'A-new.setup_tell_failed',
      'A-new.import_title', 'A-new.import_hint', 'A-new.import_choose', 'A-new.import_read', 'A-new.import_rejected', 'A-new.import_ready', 'A-new.import_confirm', 'A-new.import_cancel', 'A-new.import_saved', 'A-new.import_cancelled',
      'A-new.import_row', 'A-new.import_forbidden', 'A-new.import_general', 'A-new.import_too_big', 'A-new.import_bad'];
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
