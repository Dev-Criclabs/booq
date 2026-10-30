// Deploy guard (decision D162): a hosted build must not carry the fake LINE sign-in.
//
// NEXT_PUBLIC_LIFF_FAKE=1 swaps the real LIFF for a fake in the browser bundle. It is baked in at build time,
// so the only place to stop it is before `next build`. A hosted build is one that runs on the hosting provider
// (VERCEL is set) or says what it is (APP_ENV is preview, staging or production). Local runs and CI test
// builds, which may use the fake on purpose, set neither.
//
//   node infra/checks/forbid-liff-fake.mjs && next build        (the hosting build command for apps/web)
//
// Exit 1 and a message on stderr when the flag is set to anything but empty or "0" on a hosted build.
// Prints no environment values other than the flag itself.
const HOSTED_APP_ENVS = new Set(['preview', 'staging', 'production']);

export function checkLiffFake(env) {
  const flag = env.NEXT_PUBLIC_LIFF_FAKE;
  const on = flag !== undefined && flag !== '' && flag !== '0';
  const hosted = Boolean(env.VERCEL) || HOSTED_APP_ENVS.has(env.APP_ENV ?? '');
  if (on && hosted) {
    return { ok: false, message: `NEXT_PUBLIC_LIFF_FAKE is "${flag}" on a hosted build. It swaps real LINE sign-in for a fake. Unset it in the hosting project's environment variables and build again.` };
  }
  return { ok: true, message: on ? 'NEXT_PUBLIC_LIFF_FAKE is on, allowed because this is not a hosted build.' : 'NEXT_PUBLIC_LIFF_FAKE is off.' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = checkLiffFake(process.env);
  (r.ok ? console.log : console.error)(r.message);
  process.exit(r.ok ? 0 : 1);
}
