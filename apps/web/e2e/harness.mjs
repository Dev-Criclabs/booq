// Player app end-to-end harness (Playwright library + node:test). Starts `next dev` with the LIFF
// fake allowed (NEXT_PUBLIC_LIFF_FAKE=1; F02-T18 brings the real LIFF), then each test fakes the
// club API with page.route, so no database is needed. Screenshots go to e2e/screenshots/ (not in git).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const paths = (process.env.NODE_PATH ?? '').split(':').filter(Boolean).concat('/opt/node-tools/node_modules');
    return require(require.resolve('playwright', { paths }));
  }
}
export const { chromium } = loadPlaywright();

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = join(WEB, 'e2e', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

export async function startApp(port = 3107) {
  const child = spawn(join(WEB, 'node_modules', '.bin', 'next'), ['dev', '--port', String(port)], {
    cwd: WEB,
    env: { ...process.env, NEXT_PUBLIC_LIFF_FAKE: '1', NEXT_TELEMETRY_DISABLED: '1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`next dev exited:\n${log}`);
    try {
      const r = await fetch(`${base}/c/hunter/sign-in`);
      if (r.status < 500) return { base, stop: () => child.kill('SIGTERM'), log: () => log };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`next dev did not start:\n${log}`);
}

export const CLUB = { nameTh: 'ฮันเตอร์ เทนนิส คลับ', nameEn: 'Hunter Tennis Club', defaultLanguage: 'th', status: 'live', liffId: 'liff-test', languages: ['th', 'en'], noticeVersion: 'v1' };

/**
 * A page with the club API faked. `session` answers POST /auth/session, `profile` POST /auth/profile (a reply, or a
 * function of the calls so far), `notice` GET /public/notice/{kind} as { privacy: { th: doc } }; every API call is recorded,
 * so a test can prove nothing was created.
 */
export async function openPage(browser, { liff, club = CLUB, session = { status: 200, body: { state: 'active' } }, profile = { status: 200, body: { state: 'active' } }, notice = null, me = undefined, schedule = null, extra = null, lang, width = 375, height = 812 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'th-TH' });
  if (lang) await context.addCookies([{ name: 'lang', value: lang, url: 'http://localhost' }]);
  const page = await context.newPage();
  const calls = [];
  await page.route('**/fonts.{googleapis,gstatic}.com/**', (r) => r.continue().catch(() => r.abort()));
  await page.route('**/api/c/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push({ method: req.method(), path, body: req.postData() });
    if (path.endsWith('/public/config')) {
      if (club === 'offline') return route.abort('internetdisconnected');
      if (club === null) return route.fulfill({ status: 404, json: { code: 'not_found' } });
      return route.fulfill({ status: 200, json: club });
    }
    if (path.endsWith('/auth/session') && req.method() === 'POST') return route.fulfill({ status: session.status, json: session.body });
    if (path.endsWith('/auth/profile') && req.method() === 'POST') {
      const r = typeof profile === 'function' ? profile(calls) : profile;
      return route.fulfill({ status: r.status, json: r.body });
    }
    if (schedule && /\/api\/c\/[^/]+\/(courts|schedule(\/days)?)$/.test(path)) {
      // `schedule`: { courts, days, dayFor(date) } or { offline: true }.
      if (schedule.offline) return route.abort('internetdisconnected');
      if (path.endsWith('/courts')) return route.fulfill({ status: 200, json: schedule.courts });
      if (path.endsWith('/schedule/days')) return route.fulfill({ status: 200, json: { days: schedule.days ?? [] } });
      const date = new URL(req.url()).searchParams.get('date');
      if (schedule.delayMs) await new Promise((r) => setTimeout(r, schedule.delayMs));
      return route.fulfill({ status: 200, json: schedule.dayFor(date) });
    }
    if (path.endsWith('/me/profile')) {
      // `me`: undefined or null is a guest (401); otherwise { profile, groupFor(dob) } kept in memory.
      if (!me) return route.fulfill({ status: 401, json: { code: 'sign_in_required' } });
      if (req.method() === 'PUT') {
        const change = JSON.parse(req.postData() ?? '{}');
        me.profile = { ...me.profile, ...change };
        me.profile.priceGroup = me.groupFor ? me.groupFor(me.profile.dateOfBirth) : 'adult';
      }
      return route.fulfill({ status: 200, json: me.profile });
    }
    const kind = /\/public\/notice\/(privacy|terms)$/.exec(path)?.[1];
    if (kind) {
      const lang = new URL(req.url()).searchParams.get('lang');
      const doc = notice?.[kind]?.[lang];
      return doc ? route.fulfill({ status: 200, json: doc }) : route.fulfill({ status: 404, json: { code: 'no_notice' } });
    }
    // `extra({ method, path, url, body })`: another feature's fakes (the coach portal's); a reply for route.fulfill, or null to fall through.
    if (extra) {
      const r = await extra({ method: req.method(), path, url: new URL(req.url()), body: req.postData() ? JSON.parse(req.postData()) : undefined });
      if (r) return route.fulfill(r);
    }
    return route.fulfill({ status: 404, json: { code: 'not_found' } });
  });
  if (liff) await page.addInitScript((state) => (window.__BOOQ_LIFF_FAKE__ = state), liff);
  return { context, page, calls };
}
