import { describe, expect, it } from 'vitest';
import { ADMIN_PAGES, pagesFor } from './admin-pages';
import { isPermission } from './permissions';

// F11-T01 (ADMIN-01, D58): the sidebar is the union of what the person's roles allow, from the same check as the routes.
describe('admin pages', () => {
  it('every page names a declared permission', () => {
    for (const p of ADMIN_PAGES) expect(isPermission(p.permission), `${p.id} ${p.permission}`).toBe(true);
  });
  it('front desk does not get Reports, Pricing edit, Settings or Staff', () => {
    const pages = pagesFor(['front_desk', 'player']);
    for (const hidden of ['A10', 'A13', 'A14', 'A16', 'A17', 'A0']) expect(pages).not.toContain(hidden);
    expect(pages).toEqual(expect.arrayContaining(['A1', 'A2', 'A5', 'A6', 'A7', 'A8', 'A9', 'A12']));
  });
  it('a person who is front desk and accountant sees the pages of both', () => {
    const both = pagesFor(['front_desk', 'accountant', 'player']);
    expect(both).toEqual(expect.arrayContaining(['A1', 'A2', 'A5', 'A13', 'A14', 'A16']));
    expect(both).not.toContain('A17');
  });
  it('the accountant reads the business settings, reports and receipts, and no customer or booking page', () => {
    expect(pagesFor(['accountant', 'player'])).toEqual(['A9', 'A9b', 'A13', 'A14', 'A16']);
  });
  it('the owner sees every page; a coach or a player sees none', () => {
    expect(pagesFor(['owner', 'player'])).toHaveLength(ADMIN_PAGES.length);
    expect(pagesFor(['coach', 'player'])).toEqual([]);
    expect(pagesFor(['player'])).toEqual([]);
  });
  it('no removed page is listed (A3, A4, A11, A15)', () => {
    const ids: string[] = ADMIN_PAGES.map((p) => p.id);
    for (const gone of ['A3', 'A4', 'A11', 'A15']) expect(ids).not.toContain(gone);
  });
});
