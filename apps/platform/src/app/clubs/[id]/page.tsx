import { ClubDetailScreen } from '../../../ui/ClubDetailScreen';

// P3 and the support view of one club.
export default async function ClubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClubDetailScreen id={id} />;
}
