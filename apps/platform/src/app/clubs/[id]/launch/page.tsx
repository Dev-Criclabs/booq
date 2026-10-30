import { LaunchScreen } from '../../../../ui/LaunchScreen';

// P4: the launch checks of one club.
export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LaunchScreen id={id} />;
}
