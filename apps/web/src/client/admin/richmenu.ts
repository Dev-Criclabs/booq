import { call, type Outcome } from './api';

// A16 Rich menu labels (F11-T22 follow-up; LINE-02, D54, D114, D176; F10-T15): the owner sets the Thai and English words on the six tiles of the club's LINE menu. The links are fixed
// in code. A save writes the labels and asks the worker for a build (PUT /staff/rich-menu/labels answers { build: 'queued' }); the page then reads GET /staff/rich-menu until
// nothing is waiting and the latest build is done. An empty label is "not set": the default words of the language files are used (L-0001 to L-0006).

type Fetch = typeof fetch;

export interface Tile { tile: number; th: string | null; en: string | null }
export interface Build { status: 'building' | 'active' | 'failed' | 'superseded' | string; error: string | null; at: string; uploadedAt: string | null }
export interface RichMenu { tiles: Tile[]; build: Build | null; requested: boolean }

export const TILES = [1, 2, 3, 4, 5, 6] as const;
/** The default words of each tile (the same keys the menu image uses when a label is not set). */
export const DEFAULT_KEY: Record<number, string> = { 1: 'L-0001', 2: 'L-0002', 3: 'L-0003', 4: 'L-0004', 5: 'L-0005', 6: 'L-0006' };

export const loadRichMenu = (slug: string, f: Fetch) => call<RichMenu>(slug, '/staff/rich-menu', f);
export const saveLabels = (slug: string, labels: Tile[], f: Fetch) => call<{ build: 'queued' }>(slug, '/staff/rich-menu/labels', f, { method: 'PUT', body: { labels } });

export type Draft = Record<number, { th: string; en: string }>;
export const draftOf = (tiles: readonly Tile[]): Draft => Object.fromEntries(TILES.map((n) => { const x = tiles.find((t) => t.tile === n); return [n, { th: x?.th ?? '', en: x?.en ?? '' }]; }));
const MAX = 40;
export type LabelsBody = { ok: true; labels: Tile[] } | { ok: false; key: string; tile?: number };
/** Only the tiles that changed are sent; an emptied label goes as null (the default words). A label is at most 40 characters, so it fits a tile. */
export function labelsBody(was: Draft, now: Draft): LabelsBody {
  const labels: Tile[] = [];
  for (const n of TILES) {
    const a = was[n]!;
    const b = now[n]!;
    if (a.th.trim() === b.th.trim() && a.en.trim() === b.en.trim()) continue;
    if (b.th.trim().length > MAX || b.en.trim().length > MAX) return { ok: false, key: 'A-new.set_menu_err_long', tile: n };
    labels.push({ tile: n, th: b.th.trim() === '' ? null : b.th.trim(), en: b.en.trim() === '' ? null : b.en.trim() });
  }
  return labels.length === 0 ? { ok: false, key: 'A-new.set_nothing_changed' } : { ok: true, labels };
}

/** What the page says about the menu: a build waiting or running, done, failed (the code is the worker's), or none yet. */
export type BuildState = 'none' | 'building' | 'active' | 'failed';
export function buildState(m: Pick<RichMenu, 'build' | 'requested'>): BuildState {
  if (m.requested || m.build?.status === 'building') return 'building';
  if (!m.build) return 'none';
  return m.build.status === 'failed' ? 'failed' : 'active';
}
export const STATE_KEY: Record<BuildState, string> = { none: 'A-new.set_menu_none', building: 'A-new.set_menu_building', active: 'A-new.set_menu_active', failed: 'A-new.set_menu_failed' };
/** Poll again while a build is waiting or running. */
export const shouldPoll = (m: Pick<RichMenu, 'build' | 'requested'>): boolean => buildState(m) === 'building';

export function menuErrorKey(o: Outcome<unknown>): string {
  if (o.kind === 'forbidden') return 'A-new.set_err_forbidden';
  if (o.kind === 'refused') return o.code === 'bad_input' ? 'A-new.set_menu_err_input' : 'A-new.set_err_general';
  return 'A-new.set_err_general';
}
