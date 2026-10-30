import type { createExportService } from '@booq/domain';
import { TaskRefusedError, type ClubTaskHandler } from '../task-wrapper';

// Builds one club export inside the club's context (F01-T32; PLAT-06-AC11). The payload holds
// ids only: the club and the data_export row. BOOQ staff start an export but the file and its
// link are for the owner alone (D14); this task never reads who asked.
export const CLUB_EXPORT = 'club_export';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clubExportTask(service: ReturnType<typeof createExportService>): ClubTaskHandler<{ clubId: string; exportId: string }> {
  return async (tx, payload) => {
    if (typeof payload.exportId !== 'string' || !UUID.test(payload.exportId)) throw new TaskRefusedError('the payload has no valid export id');
    await service.run(tx, payload.exportId);
  };
}
