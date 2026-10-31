import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { ReceiptsScreen } from '../../../../../ui/admin/ReceiptsScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A14 Receipts and daily close (F11-T21, ADMIN-15).
export default async function ReceiptsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="receipts">
      <ReceiptsScreen />
    </AdminFrame>
  );
}
