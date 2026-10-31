import { describe, expect, it } from 'vitest';
import { adminHasKey } from './i18n';
import { buildState, DEFAULT_KEY, draftOf, labelsBody, menuErrorKey, saveLabels, shouldPoll, STATE_KEY, TILES } from './richmenu';

// LINE menu labels (LINE-02, D114): six tiles, Thai and English; empty is "not set" (the default words); only changed tiles are sent.
const tiles = [{ tile: 1, th: 'จองคอร์ต', en: 'Book' }, { tile: 2, th: null, en: null }, { tile: 3, th: null, en: null }, { tile: 4, th: null, en: null }, { tile: 5, th: null, en: null }, { tile: 6, th: null, en: null }];

describe('labels', () => {
  it('starts from what is stored; an unset label is an empty box', () => {
    const d = draftOf(tiles);
    expect(d[1]).toEqual({ th: 'จองคอร์ต', en: 'Book' });
    expect(d[2]).toEqual({ th: '', en: '' });
    expect(Object.keys(d)).toHaveLength(6);
  });
  it('sends only the tiles that changed; an emptied label is null (the default words); labels are trimmed', () => {
    const was = draftOf(tiles);
    expect(labelsBody(was, was)).toEqual({ ok: false, key: 'A-new.set_nothing_changed' });
    expect(labelsBody(was, { ...was, 1: { th: '', en: ' Book now ' }, 4: { th: 'แพ็กเกจของฉัน', en: '' } })).toEqual({
      ok: true, labels: [{ tile: 1, th: null, en: 'Book now' }, { tile: 4, th: 'แพ็กเกจของฉัน', en: null }],
    });
  });
  it('a label over 40 characters is refused before the server', () => {
    const was = draftOf(tiles);
    expect(labelsBody(was, { ...was, 2: { th: 'ก'.repeat(41), en: '' } })).toEqual({ ok: false, key: 'A-new.set_menu_err_long', tile: 2 });
  });
  it('the save is a PUT of the labels list', async () => {
    let sent: { url: string; method: string; body: unknown } | undefined;
    const f = (async (url: string, init: RequestInit) => { sent = { url, method: String(init.method), body: JSON.parse(init.body as string) }; return new Response(JSON.stringify({ build: 'queued' }), { status: 200 }); }) as unknown as typeof fetch;
    expect(await saveLabels('h', [{ tile: 1, th: null, en: 'x' }], f)).toMatchObject({ kind: 'ok', body: { build: 'queued' } });
    expect(sent).toEqual({ url: '/api/c/h/staff/rich-menu/labels', method: 'PUT', body: { labels: [{ tile: 1, th: null, en: 'x' }] } });
  });
});

describe('the build', () => {
  const b = (status: string) => ({ status, error: null, at: '2027-01-01T03:00:00Z', uploadedAt: null });
  it('waiting or running is building; nothing yet is none; done is active; failed is failed', () => {
    expect(buildState({ build: null, requested: false })).toBe('none');
    expect(buildState({ build: null, requested: true })).toBe('building');
    expect(buildState({ build: b('building'), requested: false })).toBe('building');
    expect(buildState({ build: b('active'), requested: false })).toBe('active');
    expect(buildState({ build: b('failed'), requested: false })).toBe('failed');
    expect(buildState({ build: b('failed'), requested: true })).toBe('building');
  });
  it('the page reads again only while a build is waiting or running', () => {
    expect(shouldPoll({ build: b('building'), requested: false })).toBe(true);
    expect(shouldPoll({ build: b('active'), requested: false })).toBe(false);
  });
});

describe('refusals and text', () => {
  it('words for a bad request, a forbidden role and the rest', () => {
    expect(menuErrorKey({ kind: 'refused', status: 400, code: 'bad_input' })).toBe('A-new.set_menu_err_input');
    expect(menuErrorKey({ kind: 'forbidden' })).toBe('A-new.set_err_forbidden');
    expect(menuErrorKey({ kind: 'offline' })).toBe('A-new.set_err_general');
  });
  it('every key the card uses exists in both languages', () => {
    const keys = [...Object.values(DEFAULT_KEY), ...Object.values(STATE_KEY), 'A-new.set_nothing_changed', 'A-new.set_err_forbidden', 'A-new.set_err_general', ...['title', 'hint', 'tile', 'default', 'th', 'en', 'save', 'queued', 'uploaded', 'code', 'err_long', 'err_input'].map((k) => `A-new.set_menu_${k}`)];
    expect(TILES).toHaveLength(6);
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
});
