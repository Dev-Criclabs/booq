import { PackagesScreen } from '../../../../ui/screens/PackagesScreen';
import { requestLang } from '../../../../ui/request-lang';

// C9 Packages: a public page, the Packages rich menu tile and Home quick tile (F06-T17; PKG-02-AC7 to AC9).
export default async function PackagesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PackagesScreen slug={slug} initialLang={await requestLang()} />;
}
