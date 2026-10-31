import type { Tx } from '../../../db/src/tx';

// F11-T02: what the console shell shows besides the page list (ADMIN-01, D98, D114). Codes and plain values only; the page picks the text
// by key. The pause reason is the platform's typed reason and is shown as it was written.

export interface ShellState {
  club: { nameTh: string; nameEn: string; status: string; defaultLanguage: string };
  paused: { reason: string; since: string } | null;
  /** LINE cap state of this month for the owner: alert, reminders_stopped or over_limit; null when normal or for anyone else. */
  lineCap: 'alert' | 'reminders_stopped' | 'over_limit' | null;
  /** The reason code of a failed LINE token check, owner only. */
  lineTokenReason: string | null;
  /** BOOQ's own LINE chat for the Message BOOQ button (D178): owner only, while Paused, null while the platform has set none (the button is hidden). */
  booqSupportLineUrl: string | null;
}

export async function shellState(tx: Tx): Promise<ShellState> {
  const club = await tx.query<{ name_th: string; name_en: string; status: string; default_language: string }>(
    `select name_th, name_en, status, default_language from public.public_club_config`);
  const c = club.rows[0];
  const s = (await tx.query<{ pause_reason: string | null; paused_at: Date | null; cap_state: string | null; line_token_reason: string | null; support_line_url: string | null }>(
    `select * from app.shell_state()`)).rows[0];
  const cap = s?.cap_state;
  return {
    club: { nameTh: c?.name_th ?? '', nameEn: c?.name_en ?? '', status: c?.status ?? '', defaultLanguage: c?.default_language ?? '' },
    paused: s?.pause_reason && s.paused_at ? { reason: s.pause_reason, since: s.paused_at.toISOString() } : null,
    lineCap: cap === 'alert' || cap === 'reminders_stopped' || cap === 'over_limit' ? cap : null,
    lineTokenReason: s?.line_token_reason ?? null,
    booqSupportLineUrl: s?.support_line_url ?? null,
  };
}
