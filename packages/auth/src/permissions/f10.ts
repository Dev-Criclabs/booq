import type { PermissionFragment } from './types';

// F10 design 9 (LINE messages and rich menu). The owner reads the club's LINE status for the banners (D98, D114) and edits
// the six rich menu labels (D114). The two notification switches are the person's own (needsPerson routes), not a
// permission. No role edits a message's text or layout (LINE-03-AC4): there is no such permission.
export const permissions: PermissionFragment = {
  'line.status.read': ['owner'],
  'rich-menu.read': ['owner'],
  'rich-menu.write': ['owner'],
};
