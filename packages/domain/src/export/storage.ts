// The private bucket behind an export (design 7.5). One interface, so the provider (Supabase
// storage, S3) is chosen by DevOps and tests use the memory version. Files live under
// `{club id}/`; a link is signed for a short life and only the owner is ever given one.

export interface ExportStorage {
  put(path: string, bytes: Uint8Array): Promise<void>;
  /** A URL that works for `seconds` and then stops. */
  signedUrl(path: string, seconds: number): Promise<string>;
}

export interface MemoryStorage extends ExportStorage {
  read(path: string): Uint8Array | undefined;
  lastLinkSeconds: number | null;
}

export function createMemoryStorage(): MemoryStorage {
  const files = new Map<string, Uint8Array>();
  const s: MemoryStorage = {
    lastLinkSeconds: null,
    async put(path, bytes) {
      files.set(path, bytes);
    },
    async signedUrl(path, seconds) {
      s.lastLinkSeconds = seconds;
      return `memory://${path}?ttl=${seconds}`;
    },
    read: (path) => files.get(path),
  };
  return s;
}
