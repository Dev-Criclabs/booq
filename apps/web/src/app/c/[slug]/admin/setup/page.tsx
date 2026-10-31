import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { SetupScreen } from '../../../../../ui/admin/SetupScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A0 Setup checklist (F11-T24, ADMIN-02).
export default async function SetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="setup">
      <SetupScreen />
    </AdminFrame>
  );
}
