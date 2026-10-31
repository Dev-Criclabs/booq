import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { PricingScreen } from '../../../../../ui/admin/PricingScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A9 Products and pricing and A9b Price groups and add-ons (F11-T18, ADMIN-10, ADMIN-11).
export default async function PricingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="pricing">
      <PricingScreen />
    </AdminFrame>
  );
}
