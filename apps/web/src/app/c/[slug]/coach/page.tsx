import { requestLang } from '../../../../ui/request-lang';
import { TodayScreen } from '../../../../ui/coach/TodayScreen';

// K1 Today (CPORT-01): the coach portal's first page. The person and the coach role are checked by the server on every call.
export default async function CoachTodayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TodayScreen slug={slug} initialLang={await requestLang()} />;
}
