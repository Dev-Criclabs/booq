import { describe, expect, it } from 'vitest';
import { buildCrontab, readWorkerConfig } from './config';

// F01-T34 start script pieces (FA 5): every operational value is config; none is invented here.
const ENV = {
  DATABASE_URL: 'postgres://w:pw@db/booq',
  WORKER_QUEUE_URL: 'postgres://q:pw@direct-db/booq',
  WORKER_HOUSEKEEPING_CRON: '*/5 * * * *',
  WORKER_IMPORT_SWEEP_CRON: '17 * * * *',
  WORKER_RATE_LIMIT_SWEEP_CRON: '41 * * * *',
  WORKER_PAY_TAP_PRUNE_CRON: '23 * * * *',
  WORKER_CLASS_GENERATE_CRON: '5 17 * * *',
  WORKER_RATE_LIMIT_KEEP_SECONDS: '86400',
  WORKER_CONSOLE_SWEEP_CRON: '53 * * * *',
  WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS: '43200',
  WORKER_HOLD_RELEASE_TICK_SECONDS: '20',
  WORKER_PACKAGE_EXPIRE_CRON: '*/5 * * * *',
  WORKER_WALLET_EXPIRE_CRON: '7 17 * * *',
  WORKER_SESSION_START_CRON: '* * * * *',
  WORKER_OFFER_EXPIRY_TICK_SECONDS: '30',
  WORKER_CLASS_BELOW_MIN_TICK_SECONDS: '60',
  WORKER_OUTBOX_SENDER_TICK_SECONDS: '30',
  LINE_API_BASE_URL: 'https://api.line.me',
  LINE_API_DATA_BASE_URL: 'https://api-data.line.me',
  LINE_PUSH_TIMEOUT_MS: '10000',
  LOCALES_DIR: '/srv/booq/locales',
  WORKER_BEAM_RECONCILE_CRON: '*/5 * * * *',
  WORKER_PACKAGE_ORDER_EXPIRY_CRON: '* * * * *',
  WORKER_CLOSURE_ROLL_CRON: '11 17 * * *',
};

describe('readWorkerConfig', () => {
  it('reads the values', () => {
    expect(readWorkerConfig(ENV)).toEqual({
      databaseUrl: ENV.DATABASE_URL,
      queueUrl: ENV.WORKER_QUEUE_URL,
      housekeepingCron: '*/5 * * * *',
      importSweepCron: '17 * * * *',
      rateLimitSweepCron: '41 * * * *',
      payTapPruneCron: '23 * * * *',
      classGenerateCron: '5 17 * * *',
      rateLimitKeepSeconds: 86400,
      consoleSweepCron: '53 * * * *',
      consoleSessionAbsoluteSeconds: 43200,
      holdReleaseTickSeconds: 20,
      packageExpireCron: '*/5 * * * *',
      walletExpireCron: '7 17 * * *',
      sessionStartCron: '* * * * *',
      offerExpiryTickSeconds: 30,
      classBelowMinTickSeconds: 60,
      outboxSenderTickSeconds: 30,
      lineApiBaseUrl: 'https://api.line.me',
      lineApiDataBaseUrl: 'https://api-data.line.me',
      linePushTimeoutMs: 10000,
      localesDir: '/srv/booq/locales',
      beamReconcileCron: '*/5 * * * *',
      packageOrderExpiryCron: '* * * * *',
      closureRollCron: '11 17 * * *',
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
    expect(message).toContain('WORKER_RATE_LIMIT_SWEEP_CRON');
    expect(message).toContain('WORKER_PAY_TAP_PRUNE_CRON');
    expect(message).toContain('WORKER_RATE_LIMIT_KEEP_SECONDS');
    expect(message).toContain('WORKER_CONSOLE_SWEEP_CRON');
    expect(message).toContain('WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS');
    expect(message).toContain('WORKER_HOLD_RELEASE_TICK_SECONDS');
    expect(message).toContain('WORKER_PACKAGE_EXPIRE_CRON');
    expect(message).toContain('WORKER_WALLET_EXPIRE_CRON');
    expect(message).toContain('WORKER_SESSION_START_CRON');
    expect(message).toContain('WORKER_CLASS_GENERATE_CRON');
    expect(message).toContain('WORKER_OFFER_EXPIRY_TICK_SECONDS');
    expect(message).toContain('WORKER_CLASS_BELOW_MIN_TICK_SECONDS');
    expect(message).toContain('WORKER_OUTBOX_SENDER_TICK_SECONDS');
    expect(message).toContain('LINE_API_BASE_URL');
    expect(message).toContain('LINE_API_DATA_BASE_URL');
    expect(message).toContain('LINE_PUSH_TIMEOUT_MS');
    expect(message).toContain('LOCALES_DIR');
    expect(message).not.toContain('secret');
  });
  it('refuses a schedule that is not five cron fields', () => {
    expect(() => readWorkerConfig({ ...ENV, WORKER_HOUSEKEEPING_CRON: 'every day' })).toThrow(/WORKER_HOUSEKEEPING_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_IMPORT_SWEEP_CRON: '* * * *' })).toThrow(/WORKER_IMPORT_SWEEP_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_PAY_TAP_PRUNE_CRON: 'hourly' })).toThrow(/WORKER_PAY_TAP_PRUNE_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_IMPORT_SWEEP_CRON: '* * * * * x\n0 0 * * * evil' })).toThrow(/WORKER_IMPORT_SWEEP_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_PACKAGE_EXPIRE_CRON: 'every 5 minutes' })).toThrow(/WORKER_PACKAGE_EXPIRE_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_WALLET_EXPIRE_CRON: 'daily' })).toThrow(/WORKER_WALLET_EXPIRE_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_SESSION_START_CRON: '* * * *' })).toThrow(/WORKER_SESSION_START_CRON/);
  });
});

describe('hold release tick', () => {
  it.each(['0', '-5', 'abc', '2.5', ''])('refuses %j', (v) => {
    expect(() => readWorkerConfig({ ...ENV, WORKER_HOLD_RELEASE_TICK_SECONDS: v })).toThrow(/WORKER_HOLD_RELEASE_TICK_SECONDS/);
  });
});

describe('the LINE sender settings (F10)', () => {
  it.each(['0', '-5', 'abc', '2.5', ''])('refuses an outbox sender tick of %j', (v) => {
    expect(() => readWorkerConfig({ ...ENV, WORKER_OUTBOX_SENDER_TICK_SECONDS: v })).toThrow(/WORKER_OUTBOX_SENDER_TICK_SECONDS/);
  });
  it.each(['0', '-1', '1.5', 'soon'])('refuses a push timeout of %j', (v) => {
    expect(() => readWorkerConfig({ ...ENV, LINE_PUSH_TIMEOUT_MS: v })).toThrow(/LINE_PUSH_TIMEOUT_MS/);
  });
  it('refuses a base URL that is not http(s)', () => {
    expect(() => readWorkerConfig({ ...ENV, LINE_API_BASE_URL: 'api.line.me' })).toThrow(/LINE_API_BASE_URL/);
    expect(() => readWorkerConfig({ ...ENV, LINE_API_DATA_BASE_URL: 'api-data.line.me' })).toThrow(/LINE_API_DATA_BASE_URL/);
  });
});

describe('rate limit keep time', () => {
  it.each(['0', '-5', 'abc', '2.5', ''])('refuses %j', (v) => {
    expect(() => readWorkerConfig({ ...ENV, WORKER_RATE_LIMIT_KEEP_SECONDS: v })).toThrow(/WORKER_RATE_LIMIT_KEEP_SECONDS/);
  });
});

describe('F05 job schedules', () => {
  it.each(['WORKER_BEAM_RECONCILE_CRON', 'WORKER_PACKAGE_ORDER_EXPIRY_CRON'])('%s is required and must be five cron fields', (n) => {
    const { [n]: _gone, ...rest } = ENV as Record<string, string>;
    expect(() => readWorkerConfig(rest)).toThrow(new RegExp(n));
    expect(() => readWorkerConfig({ ...ENV, [n]: 'every five minutes' })).toThrow(new RegExp(n));
  });
});

describe('F09 closure roll schedule', () => {
  it('WORKER_CLOSURE_ROLL_CRON is required and must be five cron fields', () => {
    const { WORKER_CLOSURE_ROLL_CRON: _gone, ...rest } = ENV as Record<string, string>;
    expect(() => readWorkerConfig(rest)).toThrow(/WORKER_CLOSURE_ROLL_CRON/);
    expect(() => readWorkerConfig({ ...ENV, WORKER_CLOSURE_ROLL_CRON: 'daily' })).toThrow(/WORKER_CLOSURE_ROLL_CRON/);
  });
});

describe('console session limit', () => {
  it.each(['0', '-5', 'abc', '2.5', ''])('refuses %j', (v) => {
    expect(() => readWorkerConfig({ ...ENV, WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS: v })).toThrow(/WORKER_CONSOLE_SESSION_ABSOLUTE_SECONDS/);
  });
});

describe('buildCrontab', () => {
  it('schedules housekeeping, the club dispatches, the two sweeps, the three F06 sweeps, the two F05 jobs and the F09 closure roll, one line each', () => {
    expect(buildCrontab({
      housekeepingCron: '*/5 * * * *', importSweepCron: '17 * * * *', rateLimitSweepCron: '41 * * * *', payTapPruneCron: '23 * * * *', classGenerateCron: '5 17 * * *', consoleSweepCron: '53 * * * *',
      packageExpireCron: '*/5 * * * *', walletExpireCron: '7 17 * * *', sessionStartCron: '* * * * *',
      beamReconcileCron: '*/5 * * * *', packageOrderExpiryCron: '* * * * *', closureRollCron: '11 17 * * *',
    })).toBe(
      '*/5 * * * * housekeeping\n17 * * * * import_staging_dispatch\n41 * * * * rate_limit_sweep\n23 * * * * pay_tap_prune_dispatch\n5 17 * * * class_generate_dispatch\n53 * * * * console_session_sweep\n'
        + '*/5 * * * * package_expire\n7 17 * * * wallet_expire\n* * * * * session_start\n'
        + '*/5 * * * * beam_reconcile\n* * * * * package_order_expiry\n'
        + '11 17 * * * closure_roll\n',
    );
  });
});
