import { StepUpScreen } from '../../ui/StepUpScreen';

// The step-up (D161) on its own page.
export default async function StepUpPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <StepUpScreen next={typeof next === 'string' ? next : null} />;
}
