import { createHash, randomBytes } from 'node:crypto';

// Invite tokens (SR-01, F01 design 3.2). A token is 32 random bytes shown only in the emailed link;
// the database stores its hash (club_invite.token_hash), so a leaked table cannot be redeemed.
// F02's redemption hashes the incoming token with the same function.

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  if (token === '') throw new Error('hashInviteToken: empty token');
  return createHash('sha256').update(token).digest('hex');
}
