import { NoticeScreen } from '../../../../ui/screens/NoticeScreen';
import { requestLang } from '../../../../ui/request-lang';

// The club's privacy notice (D152), linked from C1 and C2.
export default async function PrivacyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <NoticeScreen slug={slug} kind="privacy" initialLang={await requestLang()} />;
}
