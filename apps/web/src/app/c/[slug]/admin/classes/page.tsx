import { AdminFrame } from '../../../../../ui/admin/AdminFrame';
import { ClassesScreen } from '../../../../../ui/admin/ClassesScreen';
import { requestLang } from '../../../../../ui/request-lang';

// A8 Group classes (F11-T17, ADMIN-09).
export default async function ClassesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <AdminFrame slug={slug} initialLang={await requestLang()} current="classes">
      <ClassesScreen />
    </AdminFrame>
  );
}
