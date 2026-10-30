import { route, RouteError, type Route, type RouteContext } from '@booq/auth';
import type { Db } from '@booq/db';

// GET /public/notice/:kind?lang=th|en (D152; AUTH-02-AC8, PDPA-01-AC11, AC12; docs/architecture/legal-notice.md).
// The privacy notice or the terms of the current release for the club in the path, in one language, from
// app.render_notice. Public: a guest reads it before giving consent. It answers only the rendered
// document (version, language, title, body), never other club columns. Nothing published: 404 no_notice.

export interface NoticeRouteDeps {
  db: Db;
  clubBySlug(slug: string): Promise<{ clubId: string } | null>;
}

export interface NoticeBody {
  version: string;
  language: 'th' | 'en';
  title: string;
  body: string;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS = new Set(['privacy', 'terms']);
const LANGS = new Set(['th', 'en']);

const inputOf = (ctx: RouteContext) => (ctx.input ?? {}) as Record<string, unknown>;

export function noticeRoutes(deps: NoticeRouteDeps): Route<unknown>[] {
  return [
    route({ method: 'GET', path: '/public/notice/:kind', public: true }, async (ctx) => {
      const { slug, kind, lang } = inputOf(ctx);
      if (typeof slug !== 'string' || !SLUG.test(slug)) throw new RouteError(404, 'not_found');
      if (typeof kind !== 'string' || !KINDS.has(kind)) throw new RouteError(404, 'not_found');
      if (typeof lang !== 'string' || !LANGS.has(lang)) throw new RouteError(400, 'bad_input');
      const club = await deps.clubBySlug(slug);
      if (!club) throw new RouteError(404, 'not_found');
      const doc = await deps.db.withClubTx({ clubId: club.clubId, userId: null, roles: ['guest'], source: 'player_app' }, async (tx) => {
        const r = await tx.query('select app.render_notice($1, $2) as doc', [kind, lang]);
        return (r.rows[0] as { doc: NoticeBody | null } | undefined)?.doc ?? null;
      });
      if (!doc) throw new RouteError(404, 'no_notice');
      return { version: doc.version, language: doc.language, title: doc.title, body: doc.body } satisfies NoticeBody;
    }),
  ];
}
