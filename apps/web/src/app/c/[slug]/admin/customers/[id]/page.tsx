import { AdminFrame } from '../../../../../../ui/admin/AdminFrame';
import { CustomerProfileScreen } from '../../../../../../ui/admin/CustomerProfileScreen';
import { requestLang } from '../../../../../../ui/request-lang';

// A6 Customer profile (F11-T15, ADMIN-07).
export default async function CustomerProfilePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="customers">
      <CustomerProfileScreen id={id} />
    </AdminFrame>
  );
}
