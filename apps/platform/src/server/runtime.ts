import { createPlatformDb } from '@booq/db';
import { systemClock } from '@booq/time';
import type { PlatformSource } from '../http/server';
import { createStaffIdentityClient } from '../staff/staff-identity-client';
import { createPlatformTable, readPlatformConfig, unavailableIdentity } from './context';

// The running console's wiring, built once on the first request and shared by every route handler.
let built: PlatformSource | undefined;

export function platformSource(): PlatformSource {
  if (built) return built;
  const { databaseUrl, ...config } = readPlatformConfig(process.env);
  const db = createPlatformDb({ connectionString: databaseUrl });
  const client = config.staffInvite ? createStaffIdentityClient({ url: config.staffInvite.url, signingSecret: config.staffInvite.signingSecret, now: () => systemClock.now() }) : null;
  built = createPlatformTable({ db, clock: systemClock, identity: client ?? unavailableIdentity, ...(client ? { enrolment: client } : {}), config });
  return built;
}
