import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { StaffScreen } from '../../../../../ui/admin/StaffScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A17 Staff and audit log (F11-T23, ADMIN-17).
export default async function StaffPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="staff">
      <StaffScreen />
    </AdminFrame>
  );
}
