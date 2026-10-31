import type { Tx } from '../../../db/src/tx';

// F11-T09: A0 Setup checklist (ADMIN-02; PLAT-01, D54). The owner sees steps 6 to 8 until the club is Live and tells BOOQ they are done.
// The done flags come from the club's own rows (app.owner_setup_view); this layer only shapes them. Nothing is written except the one
// "told" row. Import, rich menu labels and the settings have their own routes (F01, F10).

export type SetupStepKey = 'brand' | 'products_rules' | 'people';

export interface OwnerSetup {
  /** draft, testing, live or paused: the checklist is shown until live. */
  clubStatus: string;
  steps: { key: SetupStepKey; done: boolean }[];
  /** When the owner pressed "Tell BOOQ I'm done"; null before. */
  toldAt: string | null;
}

export async function ownerSetup(tx: Tx): Promise<OwnerSetup> {
  const r = await tx.query<{ step_key: SetupStepKey; done: boolean; told_at: Date | null }>(`select * from app.owner_setup_view()`);
  const status = await tx.query<{ status: string }>(`select status from public.public_club_config`);
  return {
    clubStatus: status.rows[0]?.status ?? '',
    steps: r.rows.map((x) => ({ key: x.step_key, done: x.done })),
    toldAt: r.rows[0]?.told_at ? r.rows[0].told_at.toISOString() : null,
  };
}

/** POST /staff/setup/done: true when this call recorded it, false when it was already told. */
export async function tellDone(tx: Tx): Promise<{ recorded: boolean }> {
  const r = await tx.query<{ r: boolean }>(`select app.owner_tell_done() as r`);
  return { recorded: r.rows[0]!.r };
}
