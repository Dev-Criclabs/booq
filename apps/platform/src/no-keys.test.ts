import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// SR-06 / D124 option 1: the platform app holds neither the Supabase service-role key nor the anon key.
// (Only apps/staff-invite, F01-T17b, may hold the service-role key.)
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

describe('apps/platform environment', () => {
  it('names no service-role or anon key in code or config', () => {
    const root = join(__dirname, '..');
    const hits: string[] = [];
    for (const f of files(root)) {
      if (/\.test\.ts$/.test(f)) continue;
      const text = readFileSync(f, 'utf8');
      if (/service[_-]?role|anon[_-]?key|SUPABASE_ANON|NEXT_PUBLIC_SUPABASE_ANON/i.test(text)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});
