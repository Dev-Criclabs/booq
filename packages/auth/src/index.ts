export const packageName = '@booq/auth';

export { can, canAll, isPermission, permissionNames, ROLES, type Role } from './permissions';
export {
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
