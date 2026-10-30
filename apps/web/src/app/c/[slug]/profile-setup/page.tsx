import { ProfileSetupScreen } from '../../../../ui/screens/ProfileSetupScreen';
import { requestLang } from '../../../../ui/request-lang';

// C2 Profile setup, first sign in at this club only (AUTH-02-AC1, AC5).
export default async function ProfileSetupPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string | string[] }> }) {
  const { slug } = await params;
  const { next } = await searchParams;
  return <ProfileSetupScreen slug={slug} next={typeof next === 'string' ? next : null} initialLang={await requestLang()} />;
}
