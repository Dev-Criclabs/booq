// Build check (F01-T13, F01-T36): a route file may export an HTTP handler only as
// `export const GET = route(...)`. A bare function, an unwrapped constant or a re-export
// has no declared permission, feature or public flag, so it fails the build.
// `serveRoutes(table, deps)` and `serveWebhook(route, deps)` count too: its table can only hold routes made by route(), and it
// checks the table (declared, no duplicates) when it is created.

export interface SourceFile {
  path: string;
  text: string;
}

export interface UndeclaredRoute {
  path: string;
  line: number;
  method: string;
}

const ROUTE_FILE = /^(apps\/[^/]+\/(?:src\/)?app\/.*|apps\/[^/]+\/src\/routes\/.*)route\.(?:ts|tsx|js|mjs)$/;
const METHOD = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const FUNCTION_EXPORT = new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+(${METHOD})\\b`);
const CONST_EXPORT = new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+(${METHOD})\\b(.*)$`);
const REEXPORT = new RegExp(`^\\s*export\\s*\\{[^}]*\\b(${METHOD})\\b[^}]*\\}`);

export function isRouteFile(path: string): boolean {
  return ROUTE_FILE.test(path.split('\\').join('/'));
}

export function findUndeclaredRoutes(files: readonly SourceFile[]): UndeclaredRoute[] {
  const out: UndeclaredRoute[] = [];
  for (const f of files) {
    const path = f.path.split('\\').join('/');
    if (!isRouteFile(path)) continue;
    const lines = f.text.split('\n');
    lines.forEach((line, i) => {
      const fn = FUNCTION_EXPORT.exec(line) ?? REEXPORT.exec(line);
      if (fn) return void out.push({ path, line: i + 1, method: fn[1] as string });
      const c = CONST_EXPORT.exec(line);
      if (!c) return;
      // The wrapper call may start on this line or the next.
      const rest = `${c[2] ?? ''} ${lines[i + 1] ?? ''}`;
      if (!/=\s*(?:route|serveRoutes|serveWebhook)\s*(?:<[^>]*>)?\s*\(/.test(rest)) out.push({ path, line: i + 1, method: c[1] as string });
    });
  }
  return out;
}
