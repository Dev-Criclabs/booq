// F10 acceptance criteria with no existing test: written by QA in the F10 sweep. Findings are it.fails and turn red when fixed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../packages/db/src/tx';
import { createWebTable } from '../../apps/web/src/server/context';
import { createPlatformTable, unavailableIdentity } from '../../apps/platform/src/server/context';
import { repoRoot } from './spec-ids';

const ROOT = repoRoot();
const touch = new Proxy({}, { get: () => { throw new Error('not reachable in this test'); } });
const web = createWebTable({
  db: touch as unknown as Db,
  verifier: { verifyIdToken: async () => ({ ok: false as const, code: 'offline' as const }) },
  now: () => new Date('2026-12-07T03:00:00Z'),
  config: { sessionSeconds: 60, maxBodyBytes: 10_000, importLimits: null },
}).table;
const platform = createPlatformTable({
  db: touch as never,
  clock: { now: () => new Date('2026-12-07T03:00:00Z') } as never,
  identity: unavailableIdentity,
  config: { signingKey: 'k'.repeat(40), maxBodyBytes: 10_000, appBaseUrl: 'https://booq.example', healthToken: 'h'.repeat(20), staffInvite: null, signInRateLimit: null },
}).table;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}
const json = (f: string) => JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')) as Record<string, unknown>;

describe('F10/LINE-03-AC4', () => {
  it('F10/LINE-03-AC4 there is no page, route or button to edit a message (A15 is removed)', () => {
    const routes = [...web.map((r) => `${r.def.method} ${r.def.path}`), ...platform.map((r) => `${r.def.method} ${r.def.path}`)];
    expect(routes.filter((r) => /message|template|broadcast|campaign/i.test(r) && !/webhook|line\/friend|class-templates/i.test(r)), 'routes that look like a message editor').toEqual([]);
    const pages = ['apps/web/src', 'apps/platform/src'].flatMap((d) => files(resolve(ROOT, d))).map((f) => f.replace(ROOT + '/', ''));
    expect(pages.filter((f) => /(message|template).*(edit|editor|compose)|(edit|editor|compose).*(message|template)|broadcast|campaign/i.test(f)), 'files that look like a message editor').toEqual([]);
  });
});

describe('F10/LINE-05-AC16', () => {
  // FINDING QA-F10-1 (severity 3, content): locales/en.json and th.json L-0021 ("See you in 2 hours" / "เจอกันในอีก 2 ชั่วโมง") type the
  // number of hours in the text. packages/line/src/messages/builder.ts uses it as the 2 hour reminder title. D116 and LINE-05-AC16:
  // the reminder hours are variables in the text, never typed in a key (TEXT-03 variable pass: keep the key, write {hours}).
  // The 24 hour reminder already does it right (L-new.msg_reminder_title_hours uses {hours}). Owner: Content role, then the builder passes hours.
  it.fails('F10/LINE-05-AC16 the reminder titles hold no typed number of hours', () => {
    const usedKeys = ['L-0021', 'L-new.msg_reminder_title_hours'];
    const all: Array<[string, string]> = [];
    for (const f of ['locales/en.json', 'locales/th.json']) {
      const j = json(f);
      for (const k of usedKeys) if (typeof j[k] === 'string') all.push([`${f}:${k}`, j[k] as string]);
    }
    const pending = json('locales/pending/f10.json');
    const walk = (n: unknown) => {
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n as Record<string, unknown>)) typeof v === 'string' && usedKeys.includes(k) ? all.push([`pending:${k}`, v]) : walk(v);
    };
    walk(pending);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.filter(([, t]) => /\b\d+\b/.test(t)).map(([k]) => k), 'reminder texts with a typed number').toEqual([]);
  });

  it('F10/LINE-05-AC16 the 24 hour reminder and the package expiring texts hold their numbers as variables', () => {
    const pending = json('locales/pending/f10.json');
    const found: Array<[string, string]> = [];
    const walk = (n: unknown) => {
      if (n && typeof n === 'object') for (const [k, v] of Object.entries(n as Record<string, unknown>)) typeof v === 'string' && (k.startsWith('L-new.msg_reminder') || k.startsWith('L-new.msg_package_expiring')) ? found.push([k, v]) : walk(v);
    };
    walk(pending);
    expect(found.length).toBeGreaterThanOrEqual(6);
    for (const [k, t] of found) expect(t, k).not.toMatch(/\b(24|14)\b/);
  });
});
