import { describe, expect, it } from 'vitest';
import { buildCrontab, readWorkerConfig } from './config';

// F01-T34 start script pieces (FA 5): every operational value is config; none is invented here.
const ENV = {
  DATABASE_URL: 'postgres://w:pw@db/booq',
  WORKER_QUEUE_URL: 'postgres://q:pw@direct-db/booq',
  WORKER_HOUSEKEEPING_CRON: '*/5 * * * *',
  WORKER_IMPORT_SWEEP_CRON: '17 * * * *',
};

describe('readWorkerConfig', () => {
  it('reads the four values', () => {
    expect(readWorkerConfig(ENV)).toEqual({
      databaseUrl: ENV.DATABASE_URL,
      queueUrl: ENV.WORKER_QUEUE_URL,
      housekeepingCron: '*/5 * * * *',
      importSweepCron: '17 * * * *',
    });
  });
  it('names every missing setting and never prints a value', () => {
    let message = '';
    try {
      readWorkerConfig({ DATABASE_URL: 'postgres://secret-user:secret-pw@h/db' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('WORKER_QUEUE_URL');
    expect(message).toContain('WORKER_HOUSEKEEPING_CRON');
    expect(message).toContain('WORKER_IMPORT_SWEEP_CRON');
    expect(message).not.toContain('secret');
  });
  it('refuses a schedule that is not five cron fields', () => {
    expect(() => readWorkerConfig({ ...ENV, WORKER_HOUSEKEEPING_CRON: 'every day' })).toThrow(/WORKER_HOUSEKEEPING_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_IMPORT_SWEEP_CRON: '* * * *' })).toThrow(/WORKER_IMPORT_SWEEP_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_IMPORT_SWEEP_CRON: '* * * * * x\n0 0 * * * evil' })).toThrow(/WORKER_IMPORT_SWEEP_CRON/);
  });
});

describe('buildCrontab', () => {
  it('schedules housekeeping and the club dispatch, one line each', () => {
    expect(buildCrontab({ housekeepingCron: '*/5 * * * *', importSweepCron: '17 * * * *' })).toBe('*/5 * * * * housekeeping\n17 * * * * import_staging_dispatch\n');
  });
});
