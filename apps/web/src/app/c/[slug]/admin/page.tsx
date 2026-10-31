import { AdminFrame } from '../../../../ui/admin/AdminFrame';
import { requestLang } from '../../../../ui/request-lang';

// The console's front door: the shell with a prompt to choose a page. Each page task adds its own page next to this one.
export default async function AdminHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AdminFrame slug={slug} initialLang={await requestLang()} />;
}
