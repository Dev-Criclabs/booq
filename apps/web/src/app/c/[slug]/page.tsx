import { HomeScreen } from '../../../ui/screens/HomeScreen';
import { requestLang } from '../../../ui/request-lang';

// C3 Home: a public page; the club's LIFF endpoint is this address (design 4.1).
export default async function HomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HomeScreen slug={slug} initialLang={await requestLang()} />;
}
