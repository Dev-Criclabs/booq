import { AdminFrame } from '../../../../../../ui/admin/AdminFrame';
import { BookingCreateScreen } from '../../../../../../ui/admin/BookingCreateScreen';
import { requestLang } from '../../../../../../ui/request-lang';

// A02 Booking create (F11-T14, ADMIN-04).
export default async function BookingNewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="calendar">
      <BookingCreateScreen />
    </AdminFrame>
  );
}
