import type { Db, Tx } from '@booq/db';
import type { Dictionary, MessageLanguage } from '@booq/line';
import { RichMenuLayoutError, renderRichMenu, resolveLabels, richMenuObject, type RichMenuApi, type StoredLabel } from '@booq/line/server';

// buildRichMenu (F10-T12; F10 design 5.5; LINE-02-AC1, AC4, AC8; PLAT-04). One club's rich menu, in this order so that a
// failure leaves the old menu working (LINE-02-AC8):
//  1. read the six labels (the owner's, else the default keys), the active menu and the LIFF id; render the image. The
//     same labels as the active menu give the same hashes: nothing is sent unless forced (Redo, D92);
//  2. record a building row; then, outside any transaction, create the menu at LINE with its six tap areas, upload the
//     image and make it the default for the Official Account;
//  3. on success, in one transaction, the old row becomes superseded and the new one active; the old menu is then deleted
//     at LINE (a failed delete leaves an unused menu there, nothing else). On any failure the new row is failed with its
//     code, a half-made menu at LINE is deleted, the old menu stays the default.
// The club's status is never touched (a Draft club stays Draft until the build works, LINE-02-AC8). Every call writes
// an audit note with its outcome (PLAT-04); the platform route also writes P6 (F10-T16).
export const RICH_MENU_BUILD = 'rich_menu_build';

export interface RichMenuBuildDeps {
  api: RichMenuApi;
  dictionary: Record<MessageLanguage, Dictionary>;
  /** The club's channel access token, read in the club's transaction; null when none is set. */
  readToken(tx: Tx, clubId: string): Promise<string | null>;
}

export type RichMenuBuildResult =
  | { outcome: 'active'; richMenuId: string }
  | { outcome: 'unchanged' }
  | { outcome: 'failed'; code: string };

const ctx = (clubId: string) => ({ clubId, userId: null, roles: [], source: 'job' as const, actorLabel: RICH_MENU_BUILD });

export async function buildRichMenu(db: Db, deps: RichMenuBuildDeps, clubId: string, options: { force: boolean }): Promise<RichMenuBuildResult> {
  type Active = { id: string; line_rich_menu_id: string | null; labels_hash: string; image_sha256: string };
  // 1 and 2a: read, render, decide, record the building row.
  const start = await db.withClubTx(ctx(clubId), async (tx) => {
    const labels = (await tx.query<StoredLabel>('select tile, label_th, label_en from public.rich_menu_label order by tile')).rows;
    const active = (await tx.query<Active>(`select id, line_rich_menu_id, labels_hash, image_sha256 from public.rich_menu where status = 'active'`)).rows[0] ?? null;
    const liffId = (await tx.query<{ l: string | null }>('select app.club_liff_id() as l')).rows[0]?.l ?? null;
    const note = (action: string, id: string | null, detail: Record<string, unknown>) =>
      id ? tx.query('select audit.note($1, $2, $3, $4)', [action, 'rich_menu', id, JSON.stringify(detail)]) : Promise.resolve();
    let rendered: ReturnType<typeof renderRichMenu>;
    let menu: ReturnType<typeof richMenuObject>;
    try {
      const resolved = resolveLabels(labels, deps.dictionary);
      rendered = renderRichMenu(resolved);
      menu = richMenuObject({ labels: resolved, liffId, dictionary: deps.dictionary, name: `booq ${clubId.slice(0, 8)} ${rendered.labelsHash.slice(0, 12)}` });
    } catch (e) {
      const code = e instanceof RichMenuLayoutError ? e.code : 'rich_menu_render_failed';
      const id = (await tx.query<{ id: string }>(
        `insert into public.rich_menu (club_id, image_sha256, labels_hash, status, error) values ($1, repeat('0', 64), repeat('0', 64), 'failed', $2) returning id`, [clubId, code])).rows[0]!.id;
      await note('rich_menu.build_failed', id, { code });
      return { done: { outcome: 'failed', code } as RichMenuBuildResult };
    }
    if (!options.force && active && active.labels_hash === rendered.labelsHash && active.image_sha256 === rendered.imageSha256) {
      await note('rich_menu.unchanged', active.id, { labels_hash: rendered.labelsHash });
      return { done: { outcome: 'unchanged' } as RichMenuBuildResult };
    }
    const token = await deps.readToken(tx, clubId);
    const id = (await tx.query<{ id: string }>(
      `insert into public.rich_menu (club_id, image_sha256, labels_hash, status, rendered_at) values ($1, $2, $3, 'building', app.now()) returning id`,
      [clubId, rendered.imageSha256, rendered.labelsHash])).rows[0]!.id;
    return { id, token, rendered, menu, oldLineId: active?.line_rich_menu_id ?? null, labelsHash: rendered.labelsHash };
  });
  if ('done' in start) return start.done;

  // 2b: LINE, outside any transaction.
  const fail = async (code: string, lineId: string | null): Promise<RichMenuBuildResult> => {
    if (lineId && start.token) await deps.api.remove(start.token, lineId).catch(() => undefined);
    await db.withClubTx(ctx(clubId), async (tx) => {
      await tx.query(`update public.rich_menu set status = 'failed', error = $2, line_rich_menu_id = $3 where id = $1 and status = 'building'`, [start.id, code, lineId]);
      await tx.query('select audit.note($1, $2, $3, $4)', ['rich_menu.build_failed', 'rich_menu', start.id, JSON.stringify({ code, labels_hash: start.labelsHash })]);
    });
    return { outcome: 'failed', code };
  };
  if (!start.token) return fail('no_token', null);
  const created = await deps.api.create(start.token, start.menu);
  if (!created.ok) return fail(created.code, null);
  const uploaded = await deps.api.upload(start.token, created.richMenuId, start.rendered.png);
  if (!uploaded.ok) return fail(uploaded.code, created.richMenuId);
  const made = await deps.api.setDefault(start.token, created.richMenuId);
  if (!made.ok) return fail(made.code, created.richMenuId);

  // 3: the new menu is the club's; the old one goes.
  await db.withClubTx(ctx(clubId), async (tx) => {
    await tx.query(`update public.rich_menu set status = 'superseded' where status = 'active' and id <> $1`, [start.id]);
    await tx.query(`update public.rich_menu set status = 'active', line_rich_menu_id = $2, uploaded_at = app.now() where id = $1`, [start.id, created.richMenuId]);
    await tx.query('select audit.note($1, $2, $3, $4)', ['rich_menu.built', 'rich_menu', start.id, JSON.stringify({ labels_hash: start.labelsHash, tiles: 6 })]);
  });
  if (start.oldLineId && start.oldLineId !== created.richMenuId) await deps.api.remove(start.token, start.oldLineId).catch(() => undefined);
  return { outcome: 'active', richMenuId: created.richMenuId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The queue task rich_menu_build, payload { clubId, force }: added by P2 step 4 Upload and Redo (F10-T16) and by an owner's
 *  label save (F10-T15). A payload without a valid club id is refused before any database call (as clubTask). A failed
 *  build is a result, not an error: it is recorded on the row and in the audit, so the queue does not retry it. */
export function richMenuBuildTask(db: Db, deps: RichMenuBuildDeps) {
  return async (payload: unknown): Promise<void> => {
    const p = payload as { clubId?: unknown; force?: unknown } | null | undefined;
    // i18n-ignore a queue refusal, never shown to anyone
    if (typeof p?.clubId !== 'string' || !UUID.test(p.clubId)) throw new Error('task refused: the payload has no valid club id');
    await buildRichMenu(db, deps, p.clubId, { force: p.force === true });
  };
}
