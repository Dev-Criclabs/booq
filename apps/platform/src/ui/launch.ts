import { errorKey, type Failure } from './club';

// The launch page's logic (P4): the checks a club must pass to go live, and recording the ones an admin records by hand
// (PUT /clubs/{id}/launch/{check}). Apart from the screen so it can be tested without a browser.

type Fetch = typeof fetch;
export interface LaunchCheck { item: string; result: string; owed_by: 'booq' | 'owner'; recorded: boolean }
export interface Launch { clubName: string; clubStatus: string; items: LaunchCheck[] }
export const RECORD_RESULTS = ['pass', 'fail', 'pending'] as const;
export type RecordResult = (typeof RECORD_RESULTS)[number];
export const MARK_KEY: Record<RecordResult, string> = { pass: 'X-new.launch_mark_pass', fail: 'X-new.launch_mark_fail', pending: 'X-new.launch_mark_pending' };

const failure = (status: number, json: { code?: string } | null): Failure => ({
  kind: 'error',
  key: errorKey(status, json?.code),
  ...(json?.code === 'step_up_required' ? { stepUp: true } : {}),
  ...(status === 401 ? { signIn: true } : {}),
  ...(status === 404 ? { notFound: true } : {}),
});
const down: Failure = { kind: 'error', key: 'X-new.club_unavailable' };

export const openChecks = (items: readonly LaunchCheck[]): number => items.filter((i) => i.result !== 'pass').length;

export async function loadLaunch(f: Fetch, id: string): Promise<{ kind: 'ok'; launch: Launch } | Failure> {
  try {
    const res = await f(`/api/clubs/${encodeURIComponent(id)}/launch`);
    const json = (await res.json().catch(() => ({}))) as Partial<Launch> & { code?: string };
    if (res.status === 200 && Array.isArray(json.items) && typeof json.clubName === 'string' && typeof json.clubStatus === 'string') return { kind: 'ok', launch: { clubName: json.clubName, clubStatus: json.clubStatus, items: json.items } };
    return failure(res.status, json);
  } catch {
    return down;
  }
}

export async function recordResult(f: Fetch, id: string, item: string, result: RecordResult): Promise<{ kind: 'done' } | Failure> {
  try {
    const res = await f(`/api/clubs/${encodeURIComponent(id)}/launch/${encodeURIComponent(item)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result }) });
    if (res.status === 200) return { kind: 'done' };
    return failure(res.status, (await res.json().catch(() => ({}))) as { code?: string });
  } catch {
    return down;
  }
}
