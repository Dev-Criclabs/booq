import type { LiffLike } from '@booq/line';

// The LIFF the player screens use (design 4.2). The sign-in logic is F02-T18's createLiffClient
// (packages/line); this file only supplies the SDK object it takes: the real @line/liff in the
// app, or a fake for e2e runs. Nothing here trusts the client: the server verifies the ID token (CC-2).

export interface LiffPort extends LiffLike {
  /** The LINE display name from the ID token, for the C2 greeting only (AUTH-02-AC7); never the full name (LINE-01-AC12). */
  getDisplayName(): string | null;
  /** Whether the player has added the club's Official Account (needs the profile scope; design 6.5). */
  getFriendship(): Promise<{ friendFlag: boolean }>;
}

/** What an e2e run puts on `window.__BOOQ_LIFF_FAKE__` (only read when the build sets NEXT_PUBLIC_LIFF_FAKE=1). */
export interface LiffFakeState {
  inClient: boolean;
  loggedIn: boolean;
  idToken: string | null;
  language: string;
  displayName?: string | null;
  /** liff.getFriendship(): true when the player is a friend of the Official Account. */
  friend?: boolean;
  /** `init` fails as LINE being unreachable. */
  offline?: boolean;
}

const FAKE_LOGGED_IN = 'booq.fake-liff.logged-in';

/** A fake LIFF: `login` marks the session logged in and goes to the redirect. */
export function fakeLiff(state: LiffFakeState, go: (url: string) => void, store?: Pick<Storage, 'getItem' | 'setItem'>): LiffPort {
  const loggedIn = () => state.loggedIn || store?.getItem(FAKE_LOGGED_IN) === '1';
  return {
    async init() {
      if (state.offline) throw new Error('offline'); // i18n-ignore: fake SDK failure, never shown
    },
    isInClient: () => state.inClient,
    isLoggedIn: loggedIn,
    login({ redirectUri }) {
      store?.setItem(FAKE_LOGGED_IN, '1');
      state.loggedIn = true;
      go(redirectUri);
    },
    getIDToken: () => (loggedIn() ? state.idToken : null),
    getLanguage: () => state.language,
    getDisplayName: () => state.displayName ?? null,
    getFriendship: async () => ({ friendFlag: state.friend ?? true }),
  };
}

/** The real SDK, loaded only in the browser and only when a page needs it. */
async function realLiff(): Promise<LiffPort> {
  const { default: liff } = await import('@line/liff');
  return {
    init: (config) => liff.init(config),
    isInClient: () => liff.isInClient(),
    isLoggedIn: () => liff.isLoggedIn(),
    login: (options) => liff.login(options),
    getIDToken: () => liff.getIDToken(),
    getLanguage: () => liff.getLanguage(),
    getDisplayName: () => {
      const name = liff.getDecodedIDToken()?.name;
      return typeof name === 'string' && name !== '' ? name : null;
    },
    getFriendship: () => liff.getFriendship(),
  };
}

let loaded: Promise<LiffPort | null> | null = null;

/** The LIFF for this page, or null when it cannot be loaded (the screen then shows the offline error). */
export function liffPort(): Promise<LiffPort | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (process.env['NEXT_PUBLIC_LIFF_FAKE'] === '1') {
    const state = (window as unknown as { __BOOQ_LIFF_FAKE__?: LiffFakeState }).__BOOQ_LIFF_FAKE__;
    if (state) return Promise.resolve(fakeLiff(state, (url) => window.location.assign(url), window.sessionStorage));
  }
  loaded ??= realLiff().catch(() => null);
  return loaded;
}
