// The in-app ask to add the club's LINE Official Account (LINE-01-AC6 to AC9; D9; design 6.5;
// assumption A-7). A player who is not a friend gets no LINE push, so the app asks: on the booking
// confirmation and on Home, at most once per session, until they are a friend. The ask never blocks
// anything (AC7, AC8). The friend state comes from liff.getFriendship() and is reported to the
// server (POST /me/line-friend) for the push choice.

export interface FriendshipSource {
  getFriendship(): Promise<{ friendFlag: boolean }>;
}

const ASKED = 'booq.friend-ask.shown';

/** Reads the friend state from LINE and reports it; null when LINE cannot tell (the ask then stays away). */
export async function checkFriendship(liff: FriendshipSource, slug: string, f: typeof fetch): Promise<boolean | null> {
  let flag: boolean;
  try {
    flag = (await liff.getFriendship()).friendFlag;
  } catch {
    return null;
  }
  try {
    await f(`/api/c/${encodeURIComponent(slug)}/me/line-friend`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friendFlag: flag }),
    });
  } catch {
    // The report is for the push choice only; the ask still works without it.
  }
  return flag;
}

/** Ask only a known non-friend, and only once in this session (per club). */
export function shouldAsk(friend: boolean | null, store: Pick<Storage, 'getItem'> | null, slug: string): boolean {
  if (friend !== false) return false;
  try {
    return store?.getItem(`${ASKED}:${slug}`) !== '1';
  } catch {
    return true;
  }
}

export function markAsked(store: Pick<Storage, 'setItem'> | null, slug: string): void {
  try {
    store?.setItem(`${ASKED}:${slug}`, '1');
  } catch {
    // Storage blocked: the ask may show again next page, which is harmless.
  }
}

/** LINE's own add-friend address for an Official Account basic id such as @hunter. */
export function addFriendUrl(oaBasicId: string | null | undefined): string | null {
  return oaBasicId && /^@[A-Za-z0-9._-]{1,40}$/.test(oaBasicId) ? `https://line.me/R/ti/p/${encodeURIComponent(oaBasicId)}` : null;
}
