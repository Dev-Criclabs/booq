// Fake LINE: shared types.
// Endpoint shapes follow LINE's public Messaging API / Login API as understood on 30 Oct 2026.
// Every one of them sits behind this fake's API, so a mismatch with the real service is fixed in one place.
// Items marked VERIFY must be checked against current LINE documentation before the fake is trusted.
import type { Lang } from '../locale';

/** A club's LINE setup: one OA, one Login channel, one LIFF app, one rich menu (hand-off, LINE integration). */
export interface ClubLineChannel {
  clubId: string;
  /** Messaging API channel access token of the club's OA. Push messages are authorised by it. */
  channelAccessToken: string;
  /** LINE Login channel id (the client_id used to verify ID tokens). */
  loginChannelId: string;
  liffId: string;
}

/** A person on LINE. The same LINE user ID can exist at two clubs (one provider). */
export interface FakeLineUser {
  lineUserId: string;
  displayName: string;
  /** The LINE app language. Not the same as the language in the player's BOOQ profile. */
  lineAppLanguage: Lang;
  /** Has the user added the club's OA as a friend? Key is clubId. */
  friendOf: Record<string, boolean>;
  /** Has the user blocked the OA? Push to a blocker fails. */
  blocked?: Record<string, boolean>;
}

export interface LineMessageObject {
  type: 'text' | 'flex' | 'template' | 'image' | string;
  [key: string]: unknown;
}

export interface PushRequest {
  to: string;
  messages: LineMessageObject[];
}

export interface RecordedPush {
  seq: number;
  at: string;
  clubId: string;
  /** The token the app used. A club B push signed with club A's token is a tenancy bug (RLS-A13). */
  channelAccessToken: string;
  to: string;
  messages: LineMessageObject[];
  /** Language the card text is actually written in, detected from the text. 'mixed' means both scripts. */
  detectedLanguage: Lang | 'mixed' | 'none';
  /** Result the fake gave back to the app. */
  status: number;
  /** False when the user is not a friend of the OA or has blocked it. VERIFY how real LINE answers (Q-27b). */
  delivered: boolean;
}

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: { type: string; uri?: string; label?: string; data?: string };
}

export interface RichMenu {
  richMenuId: string;
  size: { width: number; height: number };
  name: string;
  chatBarText: string;
  areas: RichMenuArea[];
  selected?: boolean;
}

export interface LiffProfile {
  userId: string;
  displayName: string;
  language: Lang;
  inClient: boolean;
  isFriend: boolean;
}

/** Fault injection for LINE-06 (token failure alert) and for push failure handling (Q-27). */
export interface PushFault {
  status: number;
  /** How many pushes fail. Default: all until cleared. */
  times?: number;
}
