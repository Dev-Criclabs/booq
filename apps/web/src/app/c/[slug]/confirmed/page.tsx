import { ConfirmedScreen } from '../../../../ui/screens/ConfirmedScreen';
import { requestLang } from '../../../../ui/request-lang';

// C12 Confirmed: needs a person. Pay hands over the payment that confirmed as ?payment={id}.
export default async function ConfirmedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ConfirmedScreen slug={slug} initialLang={await requestLang()} />;
}
