import type { T } from './i18n';

// The consent a new player gives on C2 (AUTH-02-AC4, AC8; PDPA-01). The server records a notice
// version with the consent. Decision D152 makes the notice and terms versioned per club and leaves
// where versions live and how notice_version is set to the Architect. Until that lands, the version
// is a fingerprint of the exact consent text the player was shown, in their language: it changes by
// itself when the writers change the text, and nothing is invented. Only this module changes then.

export const CONSENT_KEYS = ['P-0014', 'P-0007', 'P-0009'] as const;

export async function noticeVersion(t: T, lang: string): Promise<string> {
  const shown = [lang, ...CONSENT_KEYS.map((k) => `${k}=${t(k)}`)].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shown));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `text-sha256:${hex.slice(0, 32)}`;
}
