import { notFound } from 'next/navigation';
import { requestLang } from '../../../../../../../ui/request-lang';
import { SessionScreen } from '../../../../../../../ui/coach/SessionScreen';

// K5 Session detail (CPORT-05): a solo class (a booking) or a group session, of the signed-in coach. The server decides who may open it.
export default async function CoachSessionPage({ params }: { params: Promise<{ slug: string; kind: string; id: string }> }) {
  const { slug, kind, id } = await params;
  if ((kind !== 'solo' && kind !== 'group') || !/^[0-9a-f-]{8,64}$/i.test(id)) notFound();
  return <SessionScreen slug={slug} initialLang={await requestLang()} kind={kind} id={id} />;
}
