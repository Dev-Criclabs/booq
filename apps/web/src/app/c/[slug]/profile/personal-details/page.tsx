import { PersonalDetailsScreen } from '../../../../../ui/screens/PersonalDetailsScreen';
import { requestLang } from '../../../../../ui/request-lang';

// C17 Personal details (G-C17-Personal-details): the date of birth is never locked.
export default async function PersonalDetailsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PersonalDetailsScreen slug={slug} initialLang={await requestLang()} />;
}
