import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The operator's command line (D163): nothing has a default, so a missing setting or argument stops it before any connection
// is opened, with exit code 2 and nothing on standard output (the link is the only thing that ever goes there).
const ROOT = join(__dirname, '..', '..', '..');
const run = (args: string[], env: Record<string, string>) =>
  spawnSync(join(ROOT, 'node_modules', '.bin', 'vite-node'), ['apps/staff-invite/bin/bootstrap-admin.run.ts', '--', ...args], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
const FULL = { BOOTSTRAP_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none', SUPABASE_URL: 'https://p.example', SUPABASE_SERVICE_ROLE_KEY: 'k', PLATFORM_BASE_URL: 'https://console.example' };

describe('bootstrap-admin command', () => {
  it('names every missing setting and prints nothing on standard output', () => {
    const r = run(['--email', 'a@b.co', '--name', 'A', '--ttl-hours', '24'], {});
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/BOOTSTRAP_DATABASE_URL.*SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY.*PLATFORM_BASE_URL/);
  });
  it('needs the email, the name and the link life; none has a default', () => {
    for (const args of [[], ['--email', 'a@b.co', '--name', 'A'], ['--name', 'A', '--ttl-hours', '24'], ['--email', 'a@b.co', '--ttl-hours', '24']]) {
      const r = run(args, FULL);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/--ttl-hours <hours>/);
    }
  });
  it('a link life that is not a number above zero stops it', () => {
    const r = run(['--email', 'a@b.co', '--name', 'A', '--ttl-hours', 'soon'], FULL);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/number above zero/);
  });
  it('--reissue needs the link life and nothing else', () => {
    for (const args of [['--reissue'], ['--reissue', '--email', 'a@b.co', '--ttl-hours', '24'], ['--reissue', '--name', 'A', '--ttl-hours', '24']]) {
      const r = run(args, FULL);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/--reissue --ttl-hours <hours>/);
    }
  });
});
