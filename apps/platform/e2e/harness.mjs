// Console end-to-end harness (Playwright library + node:test). Starts `next dev` for apps/platform, then each test fakes the
// console API with page.route, so no database is needed. Screenshots go to e2e/screenshots/ (not in git).
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

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = join(APP, 'e2e', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

export async function startApp(port = 3117) {
  const child = spawn(join(APP, 'node_modules', '.bin', 'next'), ['dev', '--port', String(port)], {
    cwd: APP,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', PORT: String(port) },
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
      const r = await fetch(`${base}/enrol`);
      if (r.status < 500) return { base, stop: () => child.kill('SIGTERM'), log: () => log };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`next dev did not start:\n${log}`);
}

/**
 * A page with the console API faked: `handler(method, path, body)` answers { status, body }; every call is recorded so a
 * test can prove what was sent (and that the token never went in an address).
 */
export async function openPage(browser, handler, { width = 375, height = 812, origin } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'en-GB' });
  if (origin) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const page = await context.newPage();
  const calls = [];
  await page.route('**/fonts.{googleapis,gstatic}.com/**', (r) => r.continue().catch(() => r.abort()));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    calls.push({ method: req.method(), path, search: url.search, body });
    const r = handler(req.method(), path, body);
    if (r === 'offline') return route.abort('internetdisconnected');
    return route.fulfill({ status: r.status, json: r.body });
  });
  return { page, context, calls };
}
