import { BookScreen } from '../../../../ui/screens/BookScreen';
import { requestLang } from '../../../../ui/request-lang';

// C4 Book a court: a public page, the first rich menu tile (BOOK-02-AC1).
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BookScreen slug={slug} initialLang={await requestLang()} />;
}
