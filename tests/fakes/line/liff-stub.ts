// A stand in for the LIFF SDK in Playwright. It replaces window.liff before the app loads, so the real
// app code runs against a scripted LINE. Inject with installLiffStub(page, config) (page.addInitScript).
// The stub cannot prove that LIFF works inside the real LINE app: that stays a manual device check.
import type { Lang } from '../locale';

export interface LiffStubConfig {
  /** true = running inside LINE: login is silent. false = browser: the player taps Log in with LINE once. */
  inClient: boolean;
  loggedIn: boolean;
  profile: { userId: string; displayName: string; pictureUrl?: string };
  idToken: string;
  accessToken: string;
  language: Lang;
  /** false makes the app show the add OA as friend prompt (LINE-01). */
  friendFlag: boolean;
  os?: 'ios' | 'android' | 'web';
  /** Milliseconds a login() takes, to test the loading state. */
  loginDelayMs?: number;
}

/** Minimal page type so this file does not depend on Playwright. */
export interface InitScriptTarget {
  addInitScript(script: string): Promise<void>;
}

export function liffStubScript(config: LiffStubConfig): string {
  return `(() => {
  const cfg = ${JSON.stringify(config)};
  const calls = [];
  window.__liffCalls = calls;
  const rec = (name, args) => calls.push({ name, args, at: Date.now() });
  window.liff = {
    id: 'fake-liff-id',
    init: async (opts) => { rec('init', [opts]); },
    ready: Promise.resolve(),
    isInClient: () => cfg.inClient,
    isLoggedIn: () => cfg.loggedIn,
    // In a browser the real SDK redirects to LINE and back. The stub flips the flag and resolves.
    login: async (opts) => { rec('login', [opts]); await new Promise((r) => setTimeout(r, cfg.loginDelayMs || 0)); cfg.loggedIn = true; },
    logout: () => { rec('logout', []); cfg.loggedIn = false; },
    getProfile: async () => { rec('getProfile', []); if (!cfg.loggedIn) throw new Error('not logged in'); return cfg.profile; },
    getIDToken: () => (cfg.loggedIn ? cfg.idToken : null),
    getAccessToken: () => (cfg.loggedIn ? cfg.accessToken : null),
    getDecodedIDToken: () => (cfg.loggedIn ? { sub: cfg.profile.userId, name: cfg.profile.displayName } : null),
    getLanguage: () => cfg.language,
    getOS: () => cfg.os || (cfg.inClient ? 'ios' : 'web'),
    getFriendship: async () => { rec('getFriendship', []); return { friendFlag: cfg.friendFlag }; },
    isApiAvailable: () => true,
    sendMessages: async (m) => { rec('sendMessages', [m]); },
    shareTargetPicker: async (m) => { rec('shareTargetPicker', [m]); return { status: 'success' }; },
    openWindow: (o) => { rec('openWindow', [o]); },
    closeWindow: () => { rec('closeWindow', []); },
  };
})();`;
}

export async function installLiffStub(page: InitScriptTarget, config: LiffStubConfig): Promise<void> {
  await page.addInitScript(liffStubScript(config));
}
