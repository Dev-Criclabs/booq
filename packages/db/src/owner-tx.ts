import pg from 'pg';

// One transaction as the database owner, for one-off operator scripts (D163: the first admin) and nothing else. It is
// not used by any app at run time: apps connect as booq_app, booq_worker or booq_platform. The caller supplies the
// connection string of the owner role; the pool holds one connection and is closed with `end()`.
export interface OwnerTx {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface OwnerTransactor {
  transaction<T>(fn: (tx: OwnerTx) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export function createOwnerTransactor(connectionString: string): OwnerTransactor {
  const pool = new pg.Pool({ connectionString, max: 1 });
  pool.on('error', () => undefined);
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({ query: async (text, params) => ({ rows: (await client.query(text, params as unknown[])).rows }) as never });
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
