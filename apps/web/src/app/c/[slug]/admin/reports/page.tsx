import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { ReportsScreen } from '../../../../../ui/admin/ReportsScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A13 Reports and A13b Coach payouts (F11-T21, ADMIN-14).
export default async function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="reports">
      <ReportsScreen />
    </AdminFrame>
  );
}
