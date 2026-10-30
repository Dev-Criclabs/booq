// The small LIFF surface the player screens need (design 4.2). The real module is F02-T18
// (platform lane); until it lands the screens run against this interface, and tests and local
// runs install a fake. Nothing here trusts the client: the server verifies the ID token (CC-2).

export interface LiffPort {
  init(liffId: string): Promise<void>;
  /** Inside the LINE app (design 4.2 step 3). */
  isInClient(): boolean;
  isLoggedIn(): boolean;
  /** Opens LINE's own login; LINE comes back to `redirectUri`, which must be under the endpoint URL. */
  login(redirectUri: string): void;
  getIDToken(): string | null;
  /** The LINE app language, such as `th` or `en-US` (design 6.7). */
  getLanguage(): string;
}

/** What a test or a local run puts on `window.__BOOQ_LIFF_FAKE__` (only read when the build allows it). */
export interface LiffFakeState {
  inClient: boolean;
  loggedIn: boolean;
  idToken: string | null;
  language: string;
  /** `init` fails as LINE being unreachable. */
  offline?: boolean;
}

const FAKE_LOGGED_IN = 'booq.fake-liff.logged-in';

/** A fake LIFF for tests: `login` marks the session logged in and goes to the redirect. */
export function fakeLiff(state: LiffFakeState, go: (url: string) => void, store?: Pick<Storage, 'getItem' | 'setItem'>): LiffPort {
  return {
    async init() {
      if (state.offline) throw new Error('offline');
    },
    isInClient: () => state.inClient,
    isLoggedIn: () => state.loggedIn || store?.getItem(FAKE_LOGGED_IN) === '1',
    login(redirectUri) {
      store?.setItem(FAKE_LOGGED_IN, '1');
      state.loggedIn = true;
      go(redirectUri);
    },
    getIDToken: () => (state.loggedIn || store?.getItem(FAKE_LOGGED_IN) === '1' ? state.idToken : null),
    getLanguage: () => state.language,
  };
}

let installed: LiffPort | null = null;

/** F02-T18 installs the real LIFF here. */
export function installLiff(port: LiffPort): void {
  installed = port;
}

/** The LIFF to use, or null when none is available (the screen then shows the offline error). */
export function liffPort(): LiffPort | null {
  if (installed) return installed;
  if (process.env['NEXT_PUBLIC_LIFF_FAKE'] === '1' && typeof window !== 'undefined') {
    const state = (window as unknown as { __BOOQ_LIFF_FAKE__?: LiffFakeState }).__BOOQ_LIFF_FAKE__;
    if (state) return fakeLiff(state, (url) => window.location.assign(url), window.sessionStorage);
  }
  return null;
}
