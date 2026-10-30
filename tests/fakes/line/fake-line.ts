import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Clock } from '../clock';
import type { Lang } from '../locale';
import { detectLanguage, validateFlexLimits } from './flex';
import type {
  ClubLineChannel,
  FakeLineUser,
  LiffProfile,
  PushFault,
  PushRequest,
  RecordedPush,
  RichMenu,
} from './types';

export interface FakeLineOptions {
  clock: Clock;
  channels: ClubLineChannel[];
  users?: FakeLineUser[];
  /**
   * What a push to a non friend or blocker does. VERIFY against real LINE (Q-27b).
   * 'accept-silently' = status 200, not delivered. 'reject' = 4xx.
   */
  undeliverable?: 'accept-silently' | 'reject';
}

export interface PushQuery {
  clubId?: string;
  to?: string;
  language?: Lang | 'mixed' | 'none';
  type?: string;
}

interface IdTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  name: string;
}

/**
 * In-process LINE: Messaging API (push, quota, rich menu), LINE Login (ID token verify, friendship) and LIFF
 * profile data. Records everything per club so a test can assert what each club's OA sent, to whom, in which language.
 */
export class FakeLine {
  private readonly clock: Clock;
  private readonly byToken = new Map<string, ClubLineChannel>();
  private readonly byLoginChannel = new Map<string, ClubLineChannel>();
  private readonly users = new Map<string, FakeLineUser>();
  private readonly undeliverable: 'accept-silently' | 'reject';
  private readonly richMenus = new Map<string, { clubId: string; menu: RichMenu }>();
  private readonly defaultRichMenu = new Map<string, string>(); // clubId -> richMenuId
  private readonly faults = new Map<string, PushFault>(); // token -> fault
  private readonly accessTokens = new Map<string, { lineUserId: string; clubId: string }>();
  readonly pushLog: RecordedPush[] = [];
  private seq = 0;

  constructor(opts: FakeLineOptions) {
    this.clock = opts.clock;
    this.undeliverable = opts.undeliverable ?? 'accept-silently';
    for (const c of opts.channels) {
      this.byToken.set(c.channelAccessToken, c);
      this.byLoginChannel.set(c.loginChannelId, c);
    }
    for (const u of opts.users ?? []) this.users.set(u.lineUserId, u);
  }

  // ---------- people ----------

  addUser(user: FakeLineUser): void {
    this.users.set(user.lineUserId, user);
  }

  setFriend(lineUserId: string, clubId: string, isFriend: boolean): void {
    const u = this.mustUser(lineUserId);
    u.friendOf[clubId] = isFriend;
  }

  // ---------- LINE Login / LIFF ----------

  /** What liff.getIDToken() would return inside LINE for this club's Login channel. */
  issueIdToken(lineUserId: string, clubId: string, ttlSeconds = 3600): string {
    const ch = this.channelOfClub(clubId);
    const u = this.mustUser(lineUserId);
    const payload: IdTokenPayload = {
      iss: 'https://access.line.me',
      sub: u.lineUserId,
      aud: ch.loginChannelId,
      exp: Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds,
      name: u.displayName,
    };
    return `fakeidt.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  }

  /**
   * Mirrors POST /oauth2/v2.1/verify (VERIFY exact shape). A token for club A's Login channel
   * must fail when verified against club B's channel id: that is the cross club login check.
   */
  verifyIdToken(idToken: string, clientId: string): { status: number; body: Record<string, unknown> } {
    if (!idToken.startsWith('fakeidt.')) return { status: 400, body: { error: 'invalid_request', error_description: 'Invalid IdToken.' } };
    let p: IdTokenPayload;
    try {
      p = JSON.parse(Buffer.from(idToken.slice('fakeidt.'.length), 'base64url').toString('utf8')) as IdTokenPayload;
    } catch {
      return { status: 400, body: { error: 'invalid_request', error_description: 'Invalid IdToken.' } };
    }
    if (p.aud !== clientId) return { status: 400, body: { error: 'invalid_request', error_description: 'Invalid IdToken Audience.' } };
    if (p.exp * 1000 <= this.clock.now().getTime()) return { status: 400, body: { error: 'invalid_request', error_description: 'IdToken expired.' } };
    return { status: 200, body: { iss: p.iss, sub: p.sub, aud: p.aud, exp: p.exp, name: p.name } };
  }

  issueAccessToken(lineUserId: string, clubId: string): string {
    this.mustUser(lineUserId);
    const token = `fakeat.${randomUUID()}`;
    this.accessTokens.set(token, { lineUserId, clubId });
    return token;
  }

  /** GET /friendship/v1/status (VERIFY). */
  friendship(accessToken: string): { status: number; body: Record<string, unknown> } {
    const a = this.accessTokens.get(accessToken);
    if (!a) return { status: 401, body: { error: 'invalid_token' } };
    return { status: 200, body: { friendFlag: this.mustUser(a.lineUserId).friendOf[a.clubId] === true } };
  }

  /** The profile a LIFF stub returns inside the browser (see liff-stub.ts). */
  liffProfile(lineUserId: string, clubId: string, inClient: boolean): LiffProfile {
    const u = this.mustUser(lineUserId);
    return {
      userId: u.lineUserId,
      displayName: u.displayName,
      language: u.lineAppLanguage,
      inClient,
      isFriend: u.friendOf[clubId] === true,
    };
  }

  // ---------- Messaging API ----------

  /** Fault injection. LINE-06: failToken(token, 401). Q-27b: failNext(token, {status: 500, times: 2}). */
  injectFault(token: string, fault: PushFault | null): void {
    if (fault) this.faults.set(token, { ...fault });
    else this.faults.delete(token);
  }

  /** POST /v2/bot/message/push (VERIFY). */
  push(token: string, req: PushRequest): { status: number; body: Record<string, unknown> } {
    const ch = this.byToken.get(token);
    if (!ch) return { status: 401, body: { message: 'Authentication failed due to the following reason: invalid token.' } };

    const fault = this.faults.get(token);
    if (fault) {
      if (fault.times !== undefined) {
        fault.times -= 1;
        if (fault.times <= 0) this.faults.delete(token);
      }
      return { status: fault.status, body: { message: 'injected fault' } };
    }

    const limitProblems = validateFlexLimits(req.messages);
    if (limitProblems.length > 0) return { status: 400, body: { message: 'The request body has invalid properties', details: limitProblems } };

    const user = this.users.get(req.to);
    const deliverable = !!user && user.friendOf[ch.clubId] === true && user.blocked?.[ch.clubId] !== true;
    if (!deliverable && this.undeliverable === 'reject') {
      return { status: 400, body: { message: 'Failed to send messages' } };
    }
    this.pushLog.push({
      seq: ++this.seq,
      at: this.clock.now().toISOString(),
      clubId: ch.clubId,
      channelAccessToken: token,
      to: req.to,
      messages: req.messages,
      detectedLanguage: detectLanguage(req.messages),
      status: 200,
      delivered: deliverable,
    });
    return { status: 200, body: {} };
  }

  pushes(q: PushQuery = {}): RecordedPush[] {
    return this.pushLog.filter(
      (p) =>
        (q.clubId === undefined || p.clubId === q.clubId) &&
        (q.to === undefined || p.to === q.to) &&
        (q.language === undefined || p.detectedLanguage === q.language) &&
        (q.type === undefined || p.messages.some((m) => m.type === q.type)),
    );
  }

  /**
   * GET /v2/bot/message/quota/consumption (VERIFY). Counts each message object per recipient,
   * for the Bangkok calendar month of `at`. Q-27e: confirm against LINE's counting rule.
   */
  messagesUsedThisMonth(token: string, at: Date = this.clock.now()): number {
    const ch = this.byToken.get(token);
    if (!ch) throw new Error('unknown token');
    const month = bangkokMonth(at);
    return this.pushLog
      .filter((p) => p.clubId === ch.clubId && p.delivered && bangkokMonth(new Date(p.at)) === month)
      .reduce((n, p) => n + p.messages.length, 0);
  }

  // ---------- Rich menu (LINE-02) ----------

  /** POST /v2/bot/richmenu (VERIFY). */
  createRichMenu(token: string, menu: Omit<RichMenu, 'richMenuId'>): { status: number; body: Record<string, unknown> } {
    const ch = this.byToken.get(token);
    if (!ch) return { status: 401, body: { message: 'invalid token' } };
    const richMenuId = `richmenu-${randomUUID()}`;
    this.richMenus.set(richMenuId, { clubId: ch.clubId, menu: { ...menu, richMenuId } });
    return { status: 200, body: { richMenuId } };
  }

  setDefaultRichMenu(token: string, richMenuId: string): { status: number; body: Record<string, unknown> } {
    const ch = this.byToken.get(token);
    const entry = this.richMenus.get(richMenuId);
    if (!ch || !entry || entry.clubId !== ch.clubId) return { status: 404, body: { message: 'not found' } };
    this.defaultRichMenu.set(ch.clubId, richMenuId);
    return { status: 200, body: {} };
  }

  defaultRichMenuOf(clubId: string): RichMenu | undefined {
    const id = this.defaultRichMenu.get(clubId);
    return id ? this.richMenus.get(id)?.menu : undefined;
  }

  // ---------- HTTP surface so the real app adapter can point at the fake ----------

  /** Start an HTTP server exposing the endpoints above. Set the app's LINE base URL to the returned url. */
  async serve(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer((req, res) => {
      void this.handle(req).then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const addr = server.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    return { url: `http://127.0.0.1:${p}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; body: Record<string, unknown> }> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const raw = await readBody(req);
    const bearer = (req.headers['authorization'] ?? '').toString().replace(/^Bearer\s+/i, '');
    if (req.method === 'POST' && url.pathname === '/v2/bot/message/push') return this.push(bearer, JSON.parse(raw || '{}') as PushRequest);
    if (req.method === 'POST' && url.pathname === '/oauth2/v2.1/verify') {
      const form = new URLSearchParams(raw);
      return this.verifyIdToken(form.get('id_token') ?? '', form.get('client_id') ?? '');
    }
    if (req.method === 'GET' && url.pathname === '/v2/bot/message/quota/consumption') {
      if (!this.byToken.has(bearer)) return { status: 401, body: { message: 'invalid token' } };
      return { status: 200, body: { totalUsage: this.messagesUsedThisMonth(bearer) } };
    }
    if (req.method === 'POST' && url.pathname === '/v2/bot/richmenu') return this.createRichMenu(bearer, JSON.parse(raw || '{}') as Omit<RichMenu, 'richMenuId'>);
    if (req.method === 'GET' && url.pathname === '/friendship/v1/status') return this.friendship(bearer);
    return { status: 404, body: { message: `fake LINE: no route ${req.method} ${url.pathname}` } };
  }

  // ---------- internals ----------

  private channelOfClub(clubId: string): ClubLineChannel {
    for (const c of this.byToken.values()) if (c.clubId === clubId) return c;
    throw new Error(`FakeLine: no channel for club ${clubId}`);
  }

  private mustUser(id: string): FakeLineUser {
    const u = this.users.get(id);
    if (!u) throw new Error(`FakeLine: unknown LINE user ${id}`);
    return u;
  }
}

function bangkokMonth(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(d);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
