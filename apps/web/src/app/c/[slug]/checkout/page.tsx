import { CheckoutScreen } from '../../../../ui/screens/CheckoutScreen';
import { requestLang } from '../../../../ui/request-lang';

// C10 Checkout: needs a person (R8-AC4). C4's Continue arrives here with the choice in the address.
export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CheckoutScreen slug={slug} initialLang={await requestLang()} />;
}
