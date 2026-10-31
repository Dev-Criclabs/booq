import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { CoachesScreen } from '../../../../../ui/admin/CoachesScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A7 Coaches (F11-T16, ADMIN-08).
export default async function CoachesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="coaches">
      <CoachesScreen />
    </AdminFrame>
  );
}
