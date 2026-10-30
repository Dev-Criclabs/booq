import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Cluster {
  adminUrl: string;
  stop(): Promise<void>;
}

function binDir(): string {
  if (process.env.BOOQ_PG_BIN) return process.env.BOOQ_PG_BIN;
  const root = '/usr/lib/postgresql';
  if (existsSync(root)) {
    const versions = readdirSync(root).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) if (existsSync(join(root, v, 'bin', 'initdb'))) return join(root, v, 'bin');
  }
  throw new Error('No Postgres server binaries found. Install Postgres 15 or later, set BOOQ_PG_BIN, or set BOOQ_TEST_DATABASE_URL to an existing server.');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

// Postgres refuses to run as root, so when the tests run as root (some CI images,
// the cloud sandbox) the server is started as the `postgres` OS user.
function asServerUser(cmd: string, args: string[]): [string, string[]] {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return ['runuser', ['-u', 'postgres', '--', cmd, ...args]];
  return [cmd, args];
}

/** Starts a throwaway Postgres on a free local port. fsync is off: this is test data only. */
export async function startCluster(): Promise<Cluster> {
  const bin = binDir();
  const root = mkdtempSync(join(tmpdir(), 'booq-pg-'));
  if (typeof process.getuid === 'function' && process.getuid() === 0) await run('chown', ['-R', 'postgres:postgres', root]);
  const data = join(root, 'data');
  const port = await freePort();

  let [cmd, args] = asServerUser(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'booq_admin', '-E', 'UTF8', '--locale=C', '--no-sync']);
  await run(cmd, args);
  const opts = `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${root} -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200`;
  [cmd, args] = asServerUser(join(bin, 'pg_ctl'), ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-o', opts, 'start']);
  await run(cmd, args);

  return {
    adminUrl: `postgres://booq_admin@127.0.0.1:${port}/postgres`,
    async stop() {
      const [c, a] = asServerUser(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
      await run(c, a).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
