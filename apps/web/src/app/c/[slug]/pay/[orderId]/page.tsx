import { PayScreen } from '../../../../../ui/screens/PayScreen';
import { requestLang } from '../../../../../ui/request-lang';

// C11 Pay by PromptPay (F05-T11): needs a person. Checkout hands the running payment over as ?payment={id}.
export default async function PayPage({ params }: { params: Promise<{ slug: string; orderId: string }> }) {
  const { slug } = await params;
  return <PayScreen slug={slug} initialLang={await requestLang()} />;
}
