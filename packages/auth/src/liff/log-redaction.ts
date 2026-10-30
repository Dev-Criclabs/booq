// Log redaction (F02-T03, LINE-01-AC13). The ID token, any access token and the
// Authorization header are never written to a log. Redaction works on field names at any
// depth and on token-shaped text inside strings, so a value pasted into a message,
// an error or a URL is scrubbed too.

export const REDACTED = '[redacted]';

const SECRET_KEYS = new Set(['idtoken', 'id_token', 'accesstoken', 'access_token', 'authorization']);
const SECRET_TEXT: readonly RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(id_?token|access_?token|authorization)(["']?\s*[:=]\s*["']?)[^\s&"',;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // a JWT (header starts with {"…)
];

export function scrubText(text: string): string {
  return text
    .replace(SECRET_TEXT[0]!, `$1 ${REDACTED}`)
    .replace(SECRET_TEXT[1]!, `$1$2${REDACTED}`)
    .replace(SECRET_TEXT[2]!, REDACTED);
}

export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message), ...(value.stack ? { stack: scrubText(value.stack) } : {}) };
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, seen);
  return out;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface Logger {
  debug(message: string, fields?: unknown): void;
  info(message: string, fields?: unknown): void;
  warn(message: string, fields?: unknown): void;
  error(message: string, fields?: unknown): void;
}

/** Wraps a line sink (stdout, a test array) so nothing reaches it unredacted. */
export function createRedactingLogger(sink: (line: string, level: LogLevel) => void): Logger {
  const write = (level: LogLevel) => (message: string, fields?: unknown) =>
    sink(JSON.stringify({ level, message: scrubText(message), ...(fields === undefined ? {} : { fields: redact(fields) }) }), level);
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
