import { createHash } from 'node:crypto';
import type { Tx } from '../../../db/src/tx';

// The Idempotency-Key of a mutating booking route (FA 3.5, 9; migration 0215). Inside the request's
// transaction: claim the key, do the work, store the answer. The same key again gets the stored answer;
// the same key with another request, or from another user, is refused with idempotency_key_reused (BK001).
// With no key the work simply runs (the functions behind these routes re-check state under their locks).

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  }
  return v;
}

export function requestHash(route: string, input: unknown): string {
  return createHash('sha256').update(`${route}\n${JSON.stringify(stable(input) ?? null)}`).digest('hex');
}

export async function withIdempotency<T>(tx: Tx, key: string | undefined, hash: string, work: () => Promise<T>): Promise<T> {
  if (key === undefined) return work();
  const begun = await tx.query<{ r: T | null }>('select app.idempotency_begin($1, $2) as r', [key, hash]);
  const stored = begun.rows[0]?.r;
  if (stored !== null && stored !== undefined) return stored;
  const result = await work();
  await tx.query('select app.idempotency_finish($1, $2::jsonb)', [key, JSON.stringify(result)]);
  return result;
}
