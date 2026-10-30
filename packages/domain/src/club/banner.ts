import type { ClubContext, Db } from '@booq/db';

// The banner state (PLAT-03-AC4, AC5, AC8): club.status plus the open club_pause row. The player
// app shows Book, Classes and Packages as paused and the club admin shows the banner with the
// reason from this. Reading it is open to every signed-in club role (the club is the caller's own).
export interface ClubBannerState {
  status: string;
  paused: { reason: string; since: string } | null;
}

export async function clubBannerState(db: Db, ctx: ClubContext): Promise<ClubBannerState> {
  return db.withClubTx(ctx, async (tx) => {
    const c = await tx.query<{ status: string }>('select status from public.club where id = $1', [ctx.clubId]);
    const status = c.rows[0]?.status ?? 'unknown';
    if (status !== 'paused') return { status, paused: null };
    const p = await tx.query<{ pause_reason: string; paused_at: Date }>(
      'select pause_reason, paused_at from public.club_pause where club_id = $1 and resumed_at is null',
      [ctx.clubId],
    );
    const row = p.rows[0];
    return { status, paused: row ? { reason: row.pause_reason, since: row.paused_at.toISOString() } : null };
  });
}
