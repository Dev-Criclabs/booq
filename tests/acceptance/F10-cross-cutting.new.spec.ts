// F10-T21 cross cutting suite (QA): the outbox holds no personal text, each message kind is sent once by its dedupe key, and the cap never blocks a booking or a payment
// (LINE-07-AC7). IDs: LINE-03-AC3, AC6, AC7, LINE-07-AC7. Read from the schema of a migrated database; the behaviour is proved by the lanes' tests, named at the bottom.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../packages/db/src/testing/harness';

let tdb: TestDatabase;
beforeAll(async () => {
  tdb = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await tdb?.close();
});

describe('F10-T21 the outbox holds references, never text', () => {
  it('message_outbox has no column for a message text, a name, a phone number, an address or a personal value: only kind, recipient reference, params, key, state and times', async () => {
    const cols = (await tdb.query(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'message_outbox' order by 1`)).rows as Array<{ column_name: string; data_type: string }>;
    expect(cols.length).toBeGreaterThan(8);
    expect(cols.filter((c) => /text|body|title|subject|message$|content|name|phone|email|address|line_?user|display/i.test(c.column_name) && !/^(kind|reason)$/.test(c.column_name)), 'a column that could hold personal text').toEqual([]);
    expect(cols.filter((c) => c.data_type === 'text' && !/^(kind|status|dedupe_key|void_reason|language|last_error|reason|source|error_code)$/.test(c.column_name)), 'free text columns').toEqual([]);
  });
  it('a message is sent once: the key is unique per club among live rows, and the row keeps its state across retries', async () => {
    const idx = (await tdb.query(`select indexdef from pg_indexes where schemaname = 'public' and tablename = 'message_outbox'`)).rows.map((r) => r.indexdef as string).join('\n');
    expect(idx).toMatch(/UNIQUE[^\n]*\(club_id, dedupe_key\)/);
  });
  it('the table is club data, append only for the application roles (no delete) and unreadable by the platform role (BOOQ staff see counts, never content, LINE-06-AC5)', async () => {
    for (const p of ['select', 'insert', 'update', 'delete']) expect((await tdb.query(`select has_table_privilege('booq_platform', 'public.message_outbox', $1) as ok`, [p])).rows[0].ok, `booq_platform ${p}`).toBe(false);
    expect((await tdb.query(`select has_table_privilege('booq_app', 'public.message_outbox', 'delete') as ok`)).rows[0].ok).toBe(false);
  });
});

describe('F10-T21 the cap never blocks a booking or a payment (LINE-07-AC7)', () => {
  it('no function of the booking, payment, cancel or closure path reads the cap state: only the message functions do', async () => {
    const rows = (await tdb.query(`select p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.prosrc ~ 'cap_state\\(\\)' order by 1`)).rows.map((r) => r.f as string);
    const allowed = new Set(['enqueue_message', 'record_line_usage', 'line_status', 'void_cap_reminders', 'mark_undeliverable', 'line_cap_state', 'cap_state', 'prepare_message_send', 'shell_state']);
    expect(rows.filter((f) => !allowed.has(f)), 'a function outside the message path reads the cap, so it could refuse a booking or a payment').toEqual([]);
  });
  it('enqueue_message answers with a row or null and never raises for a cap: the cap only makes a row undeliverable or voids a reminder', async () => {
    const src = (await tdb.query(`select p.prosrc as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'enqueue_message' order by p.oid desc limit 1`)).rows[0].s as string;
    expect(src).toMatch(/over_limit/);
    expect(src, 'a cap state must not raise an exception').not.toMatch(/raise exception[^;]*(cap|over_limit|reminders_stopped)/i);
  });
});

// Proved by behaviour in the lanes' tests (traced in F10-line-messages.traced.spec.ts):
//   a Testing club's messages are flagged and count to the cap: enqueue-message.test.ts "every row of a Testing club is is_test (D4, D32)"; line-usage-sync.test.ts "(i) no row yet this month ... Testing clubs too"
//   each kind once by its dedupe key: enqueue-message.test.ts "the same dedupe key enqueues once and returns the same id"
//   no personal keys in params: enqueue-message.test.ts and the builder tests ("no text column, no personal keys in params")
//   at 100 percent on a free plan the row is undeliverable and the booking goes on: enqueue-message.test.ts "at 100 percent on a free plan a message is queued as undeliverable"
