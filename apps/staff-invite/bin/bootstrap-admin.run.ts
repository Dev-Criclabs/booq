import { createOwnerTransactor } from '@booq/db';
import { bootstrapFirstAdmin } from '../src/bootstrap-admin';
import { createSupabaseAdmin } from '../src/supabase-admin';

// `pnpm run bootstrap:admin -- --email <email> --name <name> --ttl-hours <hours>` (D163). Run once by DevOps when a
// deployment has no admin yet, from a machine that holds the database owner's connection and the provider's admin
// credentials. Nothing has a default. It prints the enrolment link (and nothing else) to standard output, once; messages
// go to standard error. Exit codes: 0 done, 2 a missing or bad setting, 3 an active admin already exists, 4 the email is
// already a teammate, 5 the identity provider failed.
const REQUIRED_ENV = ['BOOTSTRAP_DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PLATFORM_BASE_URL'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 1 ? process.argv[i + 1] : undefined;
}
const fail = (code: number, message: string): never => {
  process.stderr.write(`bootstrap-admin: ${message}\n`);
  process.exit(code);
};

const missingEnv = REQUIRED_ENV.filter((n) => !process.env[n]);
if (missingEnv.length) fail(2, `settings missing: ${missingEnv.join(', ')}`);
const email = arg('email');
const name = arg('name');
const ttl = arg('ttl-hours');
if (!email || !name || !ttl) fail(2, 'usage: --email <email> --name <name> --ttl-hours <hours> (all three are required; no default is shipped)');
if (!/^[0-9]+(\.[0-9]+)?$/.test(ttl!)) fail(2, '--ttl-hours must be a number above zero');

const db = createOwnerTransactor(process.env['BOOTSTRAP_DATABASE_URL']!);

try {
  const result = await bootstrapFirstAdmin(
    { db, admin: createSupabaseAdmin({ url: process.env['SUPABASE_URL']!, serviceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY']! }) },
    { email: email!, displayName: name!, ttlHours: Number(ttl), consoleBaseUrl: process.env['PLATFORM_BASE_URL']! },
  );
  if (result.ok) {
    process.stderr.write(`bootstrap-admin: created the first admin; the link below works once and expires at ${result.expiresAt}. It is not stored anywhere in the clear.\n`);
    process.stdout.write(`${result.enrolmentLink}\n`);
  } else {
    const codes = { bad_input: [2, 'the email, name, link life or PLATFORM_BASE_URL is not valid'], admin_exists: [3, 'an active admin already exists; nothing was changed'], email_taken: [4, 'this email is already a teammate; nothing was changed'], provider_failed: [5, 'the identity provider could not create the user; nothing was changed'] } as const;
    const [exit, message] = codes[result.code];
    fail(exit, message);
  }
} catch {
  fail(1, 'failed before finishing; nothing was kept (the provider user, if one was made, was removed)');
} finally {
  await db.end();
}
