import { PersonPageScreen } from '../../../../ui/screens/PersonPagesScreen';
import { requestLang } from '../../../../ui/request-lang';

// C17 Profile: needs a person (AUTH-01-AC9).
export default async function ProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PersonPageScreen slug={slug} initialLang={await requestLang()} page="profile" />;
}
