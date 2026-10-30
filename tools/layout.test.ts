import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// FA 9 / build plan 3: the folders F01-T01 creates. packages/contract is not here
// until the build plan section 7 is approved.
const apps = ['web', 'platform', 'worker'];
const packages = ['db', 'auth', 'domain', 'payments', 'line', 'i18n', 'time', 'ui', 'testing'];

describe('F01-T01 monorepo layout', () => {
  it('has the workspace files', () => {
    for (const f of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'tsconfig.json', 'vitest.config.ts', '.nvmrc']) {
      expect(existsSync(f), f).toBe(true);
    }
  });

  for (const [dir, names] of [['apps', apps], ['packages', packages]] as const) {
    for (const n of names) {
      it(`${dir}/${n} is a workspace package with an entry point`, () => {
        const pkg = JSON.parse(readFileSync(`${dir}/${n}/package.json`, 'utf8'));
        expect(pkg.name).toBe(`@booq/${n}`);
        expect(pkg.private).toBe(true);
        expect(existsSync(`${dir}/${n}/src/index.ts`)).toBe(true);
        expect(existsSync(`${dir}/${n}/tsconfig.json`)).toBe(true);
      });
    }
  }
});
