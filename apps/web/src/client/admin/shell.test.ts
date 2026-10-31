import { describe, expect, it } from 'vitest';
import { adminHasKey, adminTranslator } from './i18n';
import { adminPath, bannersOf, BUILT, dayMonthOf, firstPage, GROUP_KEY, isOwnerShell, loadShell, NAV, navFor, type ShellState } from './shell';

// F11-T12 (ADMIN-01): the shell's logic. The server decides what a person may open; this lays it out.
const shell = (over: Partial<ShellState> = {}): ShellState => ({
  pages: ['A1', 'A5', 'A12'], club: { nameTh: 'ฮันเตอร์', nameEn: 'Hunter Tennis Club', status: 'live', defaultLanguage: 'th' }, paused: null, lineCap: null, lineTokenReason: null, booqSupportLineUrl: null, ...over,
});
const reply = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

describe('sidebar', () => {
  it('front desk sees Calendar, Customers and Closures under one group, nothing else', () => {
    const s = navFor(['A1', 'A2', 'A5', 'A6', 'A12']);
    expect(s.map((x) => x.group)).toEqual(['front']);
    expect(s[0]!.items.map((i) => i.segment)).toEqual(['calendar', 'customers', 'closures']);
  });
  it('the owner sees the three groups in the board order, the setup checklist first, and Products and pricing once for A9 and A9b', () => {
    const s = navFor(['A0', 'A1', 'A5', 'A7', 'A8', 'A9', 'A9b', 'A10', 'A12', 'A13', 'A14', 'A16', 'A17']);
    expect(s.map((x) => x.group)).toEqual(['top', 'front', 'setup', 'finance']);
    expect(s[0]!.items.map((i) => i.segment)).toEqual(['setup']);
    expect(s[2]!.items.map((i) => i.segment)).toEqual(['coaches', 'classes', 'pricing', 'promotions', 'settings', 'staff']);
    expect(s[3]!.items.map((i) => i.segment)).toEqual(['reports', 'receipts']);
  });
  it('a page the server did not list is not shown; an unknown id is ignored; the removed pages have no entry', () => {
    expect(navFor([])).toEqual([]);
    expect(navFor(['A99', 'A3', 'A11', 'A15'])).toEqual([]);
    expect(NAV.flatMap((n) => n.ids)).not.toEqual(expect.arrayContaining(['A3', 'A11', 'A15']));
  });
  it('the accountant who reads settings sees Settings and the finance pages', () => {
    const s = navFor(['A13', 'A14', 'A16']);
    expect(s.map((x) => x.items.map((i) => i.segment))).toEqual([['settings'], ['reports', 'receipts']]);
  });
  it('addresses stay inside the club and the console opens on the shell until a page has a screen', () => {
    expect(adminPath('hunter')).toBe('/c/hunter/admin');
    expect(adminPath('hunter', 'calendar')).toBe('/c/hunter/admin/calendar');
    expect(firstPage('hunter', ['A1'])).toBe(BUILT.has('calendar') ? '/c/hunter/admin/calendar' : '/c/hunter/admin');
  });
});

describe('banners', () => {
  it('none for a normal club', () => expect(bannersOf(shell(), 'en')).toEqual([]));
  it('paused: the title carries the Bangkok day and the reason as written', () => {
    const b = bannersOf(shell({ paused: { reason: 'Payment problem', since: '2027-01-12T17:30:00Z' } }), 'en');
    expect(b).toEqual([{ kind: 'paused', titleKey: 'A-0519', vars: { dayMonth: '13 Jan', reason: 'Payment problem' }, textKey: 'A-0520' }]);
    expect(adminTranslator('en')(b[0]!.titleKey, (b[0] as { vars: Record<string, string> }).vars)).toBe('Online booking is paused by BOOQ since 13 Jan · Payment problem');
    expect(dayMonthOf('th', '2027-01-12T17:30:00Z')).toBe('13 ม.ค.');
  });
  it('the LINE limit and a refused LINE connection each have a banner, and they stack under the pause', () => {
    const b = bannersOf(shell({ paused: { reason: 'r', since: '2027-01-13T03:00:00Z' }, lineCap: 'reminders_stopped', lineTokenReason: 'token_rejected' }), 'th');
    expect(b.map((x) => x.kind)).toEqual(['paused', 'line_token', 'line_cap']);
    expect(bannersOf(shell({ lineCap: 'over_limit' }), 'en')[0]).toMatchObject({ titleKey: 'A-new.shell_cap_over' });
    expect(bannersOf(shell({ lineCap: 'alert' }), 'en')[0]).toMatchObject({ titleKey: 'A-new.shell_cap_alert' });
  });
  it('the reason of a refused LINE connection is never shown, only the fixed words', () => {
    const b = bannersOf(shell({ lineTokenReason: 'http_401_secret_looking' }), 'en');
    expect(JSON.stringify(b)).not.toContain('http_401');
  });
  it('the owner is the one the server lists the staff page for', () => {
    expect(isOwnerShell(shell({ pages: ['A1', 'A17'] }))).toBe(true);
    expect(isOwnerShell(shell())).toBe(false);
  });
});

describe('loading the shell', () => {
  it('ready, guest, not staff, unknown club and offline each have their own outcome', async () => {
    expect(await loadShell('hunter', reply(200, shell()))).toMatchObject({ kind: 'ready', shell: { pages: ['A1', 'A5', 'A12'] } });
    expect(await loadShell('hunter', reply(401, { code: 'unauthenticated' }))).toEqual({ kind: 'guest' });
    expect(await loadShell('hunter', reply(403, { code: 'forbidden' }))).toEqual({ kind: 'forbidden' });
    expect(await loadShell('nope', reply(404, { code: 'not_found' }))).toEqual({ kind: 'not_found' });
    expect(await loadShell('hunter', reply(500, {}))).toEqual({ kind: 'offline' });
    expect(await loadShell('hunter', reply(200, { odd: true }))).toEqual({ kind: 'offline' });
    expect(await loadShell('hunter', (async () => { throw new Error('x'); }) as unknown as typeof fetch)).toEqual({ kind: 'offline' });
  });
});

describe('text', () => {
  it('every key the shell uses exists in both languages', () => {
    const keys = new Set<string>([
      ...NAV.map((n) => n.labelKey), ...Object.values(GROUP_KEY), 'A-0519', 'A-0520', 'A-0521', 'P-0326', 'P-0327', 'P-0328', 'P-new.language', 'P-new.language_toggle_th', 'P-new.language_toggle_en',
      'A-new.shell_nav_label', 'A-new.shell_welcome', 'A-new.shell_forbidden_title', 'A-new.shell_forbidden_text', 'A-new.shell_club_missing',
      'A-new.shell_cap_alert', 'A-new.shell_cap_stopped', 'A-new.shell_cap_over', 'A-new.shell_cap_text', 'A-new.shell_token_title', 'A-new.shell_token_text',
    ]);
    for (const lang of ['th', 'en'] as const) for (const k of keys) expect(adminHasKey(lang, k), `${lang} ${k}`).toBe(true);
  });
  it('the same variables in both languages for the banner with values', () => {
    expect(adminTranslator('th')('A-0519', { dayMonth: '13 ม.ค.', reason: 'x' })).toBe('BOOQ หยุดการจองออนไลน์ชั่วคราวตั้งแต่ 13 ม.ค. · x');
  });
});

describe('the Message BOOQ address (D178)', () => {
  it('links only a web address', async () => {
    const { supportHref } = await import('./shell');
    expect(supportHref('https://line.me/R/ti/p/@booq')).toBe('https://line.me/R/ti/p/@booq');
    expect(supportHref(null)).toBeNull();
    expect(supportHref('javascript:alert(1)')).toBeNull();
    expect(supportHref('line')).toBeNull();
  });
});
