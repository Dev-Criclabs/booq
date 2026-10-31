import { CreditsScreen } from '../../../../ui/screens/CreditsScreen';
import { requestLang } from '../../../../ui/request-lang';

// C14 Credits and wallet: needs a person (F06-T18; PKG-01-AC10, PKG-03-AC3).
export default async function CreditsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CreditsScreen slug={slug} initialLang={await requestLang()} />;
}
