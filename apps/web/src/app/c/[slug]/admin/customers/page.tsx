import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { CustomersScreen } from '../../../../../ui/admin/CustomersScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A5 Customers (F11-T15, ADMIN-06).
export default async function CustomersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="customers">
      <CustomersScreen />
    </AdminFrame>
  );
}
