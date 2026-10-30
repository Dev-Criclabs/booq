import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Fragment, Registry, TableClass } from './types';

const CLASSES: readonly TableClass[] = ['S', 'D', 'P', 'infra'];
const NAME = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const NOT_FRAGMENTS = new Set(['index', 'types', 'check']);

/** Merges named fragments; a table may be classified once only. */
export function mergeFragments(fragments: Record<string, Fragment>): Registry {
  const merged: Registry = {};
  const owner = new Map<string, string>();
  for (const [feature, fragment] of Object.entries(fragments)) {
    for (const [table, entry] of Object.entries(fragment)) {
      if (!NAME.test(table)) throw new Error(`${feature}: "${table}" must be written schema.table`);
      if (!CLASSES.includes(entry.class)) throw new Error(`${feature}: ${table} has an unknown class "${entry.class}"`);
      if (owner.has(table)) throw new Error(`${table} is classified twice: ${owner.get(table)} and ${feature}`);
      owner.set(table, feature);
      merged[table] = entry;
    }
  }
  return merged;
}

/** Reads every fragment file (base.ts, f01.ts, f03.ts ...) in this folder. */
export async function collectRegistry(dir: string = __dirname): Promise<Registry> {
  const fragments: Record<string, Fragment> = {};
  const files = readdirSync(dir)
    .filter((f) => /^[a-z][a-z0-9_-]*\.ts$/.test(f) && !f.endsWith('.test.ts') && !NOT_FRAGMENTS.has(f.replace(/\.ts$/, '')))
    .sort();
  for (const f of files) {
    const mod = (await import(/* @vite-ignore */ join(dir, f))) as { tables?: Fragment };
    if (!mod.tables) throw new Error(`${f} must export "tables"`);
    fragments[f.replace(/\.ts$/, '')] = mod.tables;
  }
  return mergeFragments(fragments);
}

export type { Fragment, Registry, TableClass, TableEntry } from './types';
