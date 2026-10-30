import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dictionary, Language } from './copy';

// Reads the language files for a receipt: locales/en.json and locales/th.json, and, until Content has merged them, the
// proposed keys in locales/pending/*.json (D81). A key in the main file wins over a pending one. Used by the server that
// renders a receipt and by the tests; the template itself never reads a file.
export function loadDictionary(language: Language, localesDir: string, includePending = true): Dictionary {
  const main = JSON.parse(readFileSync(join(localesDir, `${language}.json`), 'utf8')) as Record<string, string>;
  if (!includePending) return main;
  const merged: Record<string, string> = {};
  const pendingDir = join(localesDir, 'pending');
  let files: string[] = [];
  try {
    files = readdirSync(pendingDir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    files = [];
  }
  for (const f of files) {
    const body = JSON.parse(readFileSync(join(pendingDir, f), 'utf8')) as Partial<Record<Language, Record<string, string>>>;
    Object.assign(merged, body[language] ?? {});
  }
  return { ...merged, ...main };
}
