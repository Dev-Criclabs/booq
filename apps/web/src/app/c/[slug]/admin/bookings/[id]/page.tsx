import { AdminFrame } from '../../../../../../ui/admin/AdminFrame';
import { BookingDetailScreen } from '../../../../../../ui/admin/BookingDetailScreen';
import { requestLang } from '../../../../../../ui/request-lang';

// A02b Booking detail (F11-T14, ADMIN-04).
export default async function BookingDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="calendar">
      <BookingDetailScreen id={id} />
    </AdminFrame>
  );
}
