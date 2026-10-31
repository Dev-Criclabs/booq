import { requestLang } from '../../../../../ui/request-lang';
import { ScheduleScreen } from '../../../../../ui/coach/ScheduleScreen';

// K2 Schedule (CPORT-02): the coach's own week.
export default async function CoachSchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ScheduleScreen slug={slug} initialLang={await requestLang()} />;
}
