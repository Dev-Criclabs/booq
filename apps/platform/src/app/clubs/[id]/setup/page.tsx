import { WizardScreen } from '../../../../ui/WizardScreen';
import { stepFromQuery } from '../../../../ui/wizard';

// P2 steps 1 to 5 of a club that already exists as a draft.
export default async function SetupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step } = await searchParams;
  return <WizardScreen id={id} step={stepFromQuery(step ?? null)} />;
}
