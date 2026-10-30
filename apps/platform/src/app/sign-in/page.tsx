import { SignInScreen } from '../../ui/SignInScreen';

// Console sign-in: email and password, then the code from the authenticator app.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <SignInScreen next={typeof next === 'string' ? next : null} />;
}
