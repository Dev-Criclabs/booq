import { AdminFrame } from '../../../../../../../ui/admin/AdminFrame';
import { SellPackageScreen } from '../../../../../../../ui/admin/SellPackageScreen';
import { requestLang } from '../../../../../../../ui/request-lang';

// A02c Sell a package (F11-T14, ADMIN-04).
export default async function SellPackagePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="customers">
      <SellPackageScreen id={id} />
    </AdminFrame>
  );
}
