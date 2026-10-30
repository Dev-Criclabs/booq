// Reads the acceptance criteria of every feature requirements.md. Used by the generator and by the coverage check.
// A criterion is a bullet "- <ID>-AC<n>. Given ..." (F01 to F06, F10) or a table row with an ADMIN-nn or CPORT-nn ID (F11, F12).
// IDs are qualified with the feature code, because R1 to R8 repeat in F04 and F06: "F04/R1-AC1".
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Criterion {
  feature: string; // F04
  featureDir: string; // F04-checkout-pricing
  group: string; // R1, PAY-07, ADMIN-03
  id: string; // F04/R1-AC1
  text: string;
}

export function repoRoot(): string {
  return fileURLToPath(new URL('../..', import.meta.url));
}

export function featureDirs(root = repoRoot()): string[] {
  const dir = resolve(root, 'specs', 'features');
  return readdirSync(dir)
    .filter((d) => /^F\d\d-/.test(d) && existsSync(resolve(dir, d, 'requirements.md')))
    .sort();
}

export function readCriteria(featureDir: string, root = repoRoot()): Criterion[] {
  const feature = featureDir.slice(0, 3);
  const lines = readFileSync(resolve(root, 'specs', 'features', featureDir, 'requirements.md'), 'utf8').split('\n');
  const out: Criterion[] = [];
  const seen = new Set<string>();
  const add = (group: string, id: string, text: string) => {
    const full = `${feature}/${id}`;
    if (seen.has(full)) return;
    seen.add(full);
    out.push({ feature, featureDir, group, id: full, text });
  };

  let acColumn = -1;
  for (const line of lines) {
    const bullet = /^- (\S+?)-AC(\d+[a-z]?)[.:]\s+(.*)$/.exec(line);
    if (bullet) {
      add(bullet[1] as string, `${bullet[1]}-AC${bullet[2]}`, bullet[3] as string);
      continue;
    }
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const idx = cells.findIndex((c) => /^Acceptance check/i.test(c));
      if (idx >= 0) {
        acColumn = idx;
        continue;
      }
      const first = cells[0] ?? '';
      if (acColumn >= 0 && /^(ADMIN|CPORT)-\d+$/.test(first)) add(first, first, cells[acColumn] ?? '');
    }
  }
  return out;
}

export function allCriteria(root = repoRoot()): Criterion[] {
  return featureDirs(root).flatMap((d) => readCriteria(d, root));
}
