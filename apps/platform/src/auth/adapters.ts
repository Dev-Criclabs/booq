import type { PlatformDb } from '@booq/db';
import type { AuditSink, StaffDirectory, StaffRecord } from './sign-in';

// The database sides of staff sign-in (F01-T17, T18): the staff lookup through the two definer
// functions that return one row each (sign-in runs before any identity is known), and the P6 writer
// through platform.write_audit, which takes the staff member from the transaction and refuses
// player data in the detail.

interface Row {
  id: string;
  auth_user_id: string;
  display_name: string;
  role: StaffRecord['role'];
  active: boolean;
}
const toRecord = (r: Row): StaffRecord => ({ id: r.id, authUserId: r.auth_user_id, displayName: r.display_name, role: r.role, active: r.active });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDbStaffDirectory(db: PlatformDb): StaffDirectory {
  const one = async (sql: string, id: string) => {
    if (!UUID.test(id)) return null;
    const row = await db.withPlatformTx({ staffId: null }, async (tx) => (await tx.query<Row>(sql, [id])).rows[0]);
    return row ? toRecord(row) : null;
  };
  return {
    findByAuthUser: (authUserId) => one('select id, auth_user_id, display_name, role, active from platform.staff_by_auth_user($1)', authUserId),
    findById: (staffId) => one('select id, auth_user_id, display_name, role, active from platform.staff_by_id($1)', staffId),
  };
}

export function createDbAuditSink(db: PlatformDb): AuditSink {
  const write = (staffId: string | null, staffName: string | null, action: string, detail: Record<string, unknown>) =>
    db.withPlatformTx({ staffId, ...(staffId ? { staffLabel: staffName ?? 'staff' } : {}) }, (tx) =>
      tx.query('select platform.write_audit($1, null, null, null, $2::jsonb, null, null)', [action, JSON.stringify(detail)]),
    );
  return {
    async write(event) {
      try {
        await write(event.staffId, event.staffName, event.action, event.detail);
      } catch (e) {
        // P6 names only active staff. An event about a deactivated account (its sessions ending, a refused
        // sign-in) is still written, with no actor and the name kept in the detail, so it is never lost.
        if (!event.staffId || !/unknown or inactive staff member/.test(String((e as Error).message))) throw e;
        await write(null, null, event.action, { ...event.detail, staff: event.staffName });
      }
    },
  };
}
