import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { CalendarScreen } from '../../../../../ui/admin/CalendarScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A1 Calendar (F11-T13, ADMIN-03).
export default async function CalendarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="calendar">
      <CalendarScreen />
    </AdminFrame>
  );
}
