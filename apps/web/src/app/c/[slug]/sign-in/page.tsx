import { SignInScreen } from '../../../../ui/screens/SignInScreen';
import { requestLang } from '../../../../ui/request-lang';

// C1 sign-in page. The club comes from the address (D6); the screen loads the public config.
export default async function SignInPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string | string[] }> }) {
  const { slug } = await params;
  const { next } = await searchParams;
  return <SignInScreen slug={slug} next={typeof next === 'string' ? next : null} initialLang={await requestLang()} />;
}
