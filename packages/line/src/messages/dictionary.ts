import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MessageLanguage } from '../sender/types';
import type { Dictionary } from './builder';

// Reads the language files for LINE messages: locales/en.json and th.json and, until Content merges them, the proposed
// keys in locales/pending/*.json (D81). A key in the main file wins over a pending one. The worker loads it once; the
// templates never read a file.
export function loadMessageDictionary(language: MessageLanguage, localesDir: string): Dictionary {
  const main = JSON.parse(readFileSync(join(localesDir, `${language}.json`), 'utf8')) as Record<string, string>;
  const merged: Record<string, string> = {};
  let files: string[] = [];
  try {
    files = readdirSync(join(localesDir, 'pending')).filter((f) => f.endsWith('.json')).sort();
  } catch {
    files = [];
  }
  for (const f of files) {
    const body = JSON.parse(readFileSync(join(localesDir, 'pending', f), 'utf8')) as Partial<Record<MessageLanguage, Record<string, string>>>;
    Object.assign(merged, body[language] ?? {});
  }
  return Object.freeze({ ...merged, ...main });
}
