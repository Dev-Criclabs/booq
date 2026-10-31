import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { PromotionsScreen } from '../../../../../ui/admin/PromotionsScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A10 Promotions (F11-T19, ADMIN-12).
export default async function PromotionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="promotions">
      <PromotionsScreen />
    </AdminFrame>
  );
}
