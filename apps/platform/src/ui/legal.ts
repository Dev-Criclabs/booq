import { errorKey, type Failure } from './club';

// The legal notice page's logic: what is published, and publishing a new version (POST /legal/releases). Apart from the screen so
// it can be tested without a browser. The texts themselves are content typed by an admin, never written in this repository.

type Fetch = typeof fetch;
export const KINDS = ['privacy', 'terms'] as const;
export const LANGUAGES = ['th', 'en'] as const;
export const PARTS = ['title', 'body'] as const;
export type Kind = (typeof KINDS)[number];
export type Language = (typeof LANGUAGES)[number];
export type Part = (typeof PARTS)[number];
export type Texts = Record<Kind, Record<Language, Record<Part, string>>>;
export interface Release { version: string; publishedAt: string; publishedBy: string | null }
export interface LegalView { releases: Release[]; current: { version: string; texts: Partial<Record<Kind, Partial<Record<Language, Record<Part, string>>>>> } | null }

export const emptyTexts = (): Texts => ({ privacy: { th: { title: '', body: '' }, en: { title: '', body: '' } }, terms: { th: { title: '', body: '' }, en: { title: '', body: '' } } });
/** The form starts from the newest version (a new one is usually a small change to it). */
export function fromCurrent(view: LegalView): Texts {
  const out = emptyTexts();
  for (const k of KINDS) for (const l of LANGUAGES) for (const p of PARTS) out[k][l][p] = view.current?.texts[k]?.[l]?.[p] ?? '';
  return out;
}

export const kindKey = (k: Kind) => `X-new.legal_kind_${k}`;
export const languageKey = (l: Language) => `X-new.legal_lang_${l}`;
export const partKey = (p: Part) => `X-new.legal_part_${p}`;

/** A date and time as the club sees them: Bangkok time, the international year. */
export function when(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts['day']} ${parts['month']} ${parts['year']}, ${parts['hour']}:${parts['minute']}`;
}

const FIELD = /\{([^{}]*)\}/g;
/** What is wrong with the texts before they are sent: an empty field, or a {field} other than the two the system fills in. */
export type Problem = { key: 'X-new.legal_missing'; kind: Kind; language: Language; part: Part } | { key: 'X-new.legal_unknown_field'; field: string };
export function check(texts: Texts): Problem | null {
  for (const k of KINDS) for (const l of LANGUAGES) for (const p of PARTS) if (texts[k][l][p].trim() === '') return { key: 'X-new.legal_missing', kind: k, language: l, part: p };
  for (const k of KINDS) for (const l of LANGUAGES) {
    for (const m of `${texts[k][l].title} ${texts[k][l].body}`.matchAll(FIELD)) if (m[1] !== 'clubName' && m[1] !== 'legalName') return { key: 'X-new.legal_unknown_field', field: m[1]! };
  }
  return null;
}

const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };
export async function loadLegal(f: Fetch): Promise<{ kind: 'ok'; view: LegalView } | Failure> {
  try {
    const res = await f('/api/legal');
    const json = (await res.json().catch(() => ({}))) as Partial<LegalView> & { code?: string };
    if (res.status === 200 && Array.isArray(json.releases)) return { kind: 'ok', view: { releases: json.releases, current: json.current ?? null } };
    return { kind: 'error', key: errorKey(res.status, json.code), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return down;
  }
}

export type PublishOutcome = { kind: 'published'; version: string } | (Failure & { problem?: Problem });
export async function publish(f: Fetch, texts: Texts): Promise<PublishOutcome> {
  const problem = check(texts);
  if (problem) return { kind: 'error', key: problem.key, problem };
  try {
    const res = await f('/api/legal/releases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts }) });
    const json = (await res.json().catch(() => ({}))) as { version?: string; code?: string; reason?: string; kind?: Kind; language?: Language; field?: string };
    if (res.status === 200 && typeof json.version === 'string') return { kind: 'published', version: json.version };
    if (json.code === 'invalid') {
      if (json.reason === 'unknown_field' && json.field) return { kind: 'error', key: 'X-new.legal_unknown_field', problem: { key: 'X-new.legal_unknown_field', field: json.field } };
      if (json.reason === 'missing_text' && json.kind && json.language) return { kind: 'error', key: 'X-new.legal_missing', problem: { key: 'X-new.legal_missing', kind: json.kind, language: json.language, part: 'title' } };
      return { kind: 'error', key: 'X-new.legal_invalid' };
    }
    return { kind: 'error', key: errorKey(res.status, json.code), ...(json.code === 'step_up_required' ? { stepUp: true } : {}), ...(res.status === 401 ? { signIn: true } : {}) };
  } catch {
    return down;
  }
}
