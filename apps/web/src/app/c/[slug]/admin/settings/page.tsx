import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { SettingsScreen } from '../../../../../ui/admin/SettingsScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A16 Settings (F11-T22, ADMIN-16).
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="settings">
      <SettingsScreen />
    </AdminFrame>
  );
}
