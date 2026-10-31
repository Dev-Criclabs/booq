import { PersonPageScreen } from '../../../../ui/screens/PersonPagesScreen';
import { requestLang } from '../../../../ui/request-lang';

// C13 My bookings: needs a person (AUTH-01-AC9); the list comes with F03 and F09.
export default async function BookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PersonPageScreen slug={slug} initialLang={await requestLang()} page="bookings" />;
}
