import { call } from './api';

// A17 Audit log (F11-T23; ADMIN-17): GET /staff/audit?staff=&type=&record=&from=&to=&cursor=, owner only, newest first, 50 a page. Read only: there
// is no route that writes or deletes. A personal value is never in the answer, only the names of the personal fields that changed (SR-04).

type Fetch = typeof fetch;

export interface AuditEntry {
  entryId: string;
  at: string;
  actorType: string;
  actorUserId: string | null;
  actorLabel: string;
  source: string;
  action: string;
  recordType: string;
  recordId: string;
  recordKey: string | null;
  oldValue: unknown;
  newValue: unknown;
  piiFields: string[];
  reason: string | null;
}
export interface AuditPage {
  entries: AuditEntry[];
  next: string | null;
}
export interface AuditQuery {
  staff: string;
  type: string;
  from: string;
  to: string;
  cursor?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TYPE = /^[a-z][a-z0-9_]{0,60}$/;

export type Checked = { ok: true } | { ok: false; key: 'A-new.audit_bad_staff' | 'A-new.audit_bad_type' | 'A-new.audit_bad_day' | 'A-new.audit_bad_range' };
/** What the filters allow, checked here so the person is told in words before the server says 400. */
export function checkQuery(q: AuditQuery): Checked {
  if (q.staff && !UUID.test(q.staff)) return { ok: false, key: 'A-new.audit_bad_staff' };
  if (q.type && !TYPE.test(q.type.trim())) return { ok: false, key: 'A-new.audit_bad_type' };
  for (const d of [q.from, q.to]) if (d && !DAY.test(d)) return { ok: false, key: 'A-new.audit_bad_day' };
  if (q.from && q.to && q.to < q.from) return { ok: false, key: 'A-new.audit_bad_range' };
  return { ok: true };
}
export function auditPath(q: AuditQuery): string {
  const p = new URLSearchParams();
  if (q.staff) p.set('staff', q.staff);
  if (q.type.trim()) p.set('type', q.type.trim());
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  if (q.cursor) p.set('cursor', q.cursor);
  const s = p.toString();
  return `/staff/audit${s ? `?${s}` : ''}`;
}
export const loadAudit = (slug: string, q: AuditQuery, f: Fetch) => call<AuditPage>(slug, auditPath(q), f);

const SHORT = 80;
const show = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > SHORT ? `${s.slice(0, SHORT - 1)}…` : s;
};
/** One line for what changed: `key: old → new` for each field of an object that differs, else `old → new`; personal fields are named, never shown. */
export function changeLines(e: Pick<AuditEntry, 'oldValue' | 'newValue' | 'piiFields'>): string[] {
  const o = e.oldValue;
  const n = e.newValue;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const lines: string[] = [];
  if (isObj(o) || isObj(n)) {
    const a = isObj(o) ? o : {};
    const b = isObj(n) ? n : {};
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
      lines.push(`${k}: ${a[k] === undefined ? '∅' : show(a[k])} → ${b[k] === undefined ? '∅' : show(b[k])}`);
    }
  } else if (o !== undefined && o !== null || n !== undefined && n !== null) {
    lines.push(`${o === undefined || o === null ? '∅' : show(o)} → ${n === undefined || n === null ? '∅' : show(n)}`);
  }
  return lines;
}
