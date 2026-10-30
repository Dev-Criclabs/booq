export const packageName = '@booq/auth';

export { can, canAll, isPermission, permissionNames, ROLES, type Role } from './permissions';
export {
  Reply,
  route,
  RouteError,
  checkRouteTable,
  validateDeclaration,
  type Route,
  type RouteContext,
  type RouteDeclaration,
  type RouteDeps,
  type RouteRequest,
  type RouteResult,
  type RouteSession,
} from './route';
export { findUndeclaredRoutes, isRouteFile, type SourceFile, type UndeclaredRoute } from './check';
export { createRedactingLogger, redact, scrubText, REDACTED, type Logger, type LogLevel } from './liff/log-redaction';
export { createLineVerifier, createFakeLineVerifier, type LineVerifier, type VerifyFailure, type VerifyRequest, type VerifyResult, type FakeVerifierMode, type LineVerifierOptions } from './liff/verify';
export { hashInviteToken, newInviteToken } from './invite';
export { clubUrl } from './liff/club-url';
export { clearSessionCookie, clubOfToken, hashToken, newSessionToken, parseSessionCookie, serializeSessionCookie, SESSION_COOKIE } from './liff/cookie';
export { createSignInService, type AuthenticateResult, type ClubTarget, type SignInDirectory, type SignInOptions, type SignInResult, type SignInTx } from './liff/session';
export { createDbDirectory } from './liff/directory';
export { createPublicConfigService, type PublicConfig, type PublicConfigResult } from './liff/public-config';
export { createProfileService, type ProfileOptions, type ProfileResult } from './liff/profile';
export { safeReturnPath } from './liff/return-path';
export { serveRoutes, type ServeContext, type ServeDeps } from './serve';
