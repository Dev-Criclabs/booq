import { DobStepScreen } from '../../../../ui/screens/DobStepScreen';
import { requestLang } from '../../../../ui/request-lang';

// The date of birth step for a Student item (AUTH-02-AC11, AC12).
export default async function DobStepPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ next?: string | string[] }> }) {
  const { slug } = await params;
  const { next } = await searchParams;
  return <DobStepScreen slug={slug} next={typeof next === 'string' ? next : null} initialLang={await requestLang()} />;
}
