import { clubHome } from './paths';
import { formatMoney } from './format';
import type { Lang, T } from './i18n';

// C9 Packages (F06-T17; PKG-02-AC7 to AC9; H-C09, H-C09b, H-C09c). The products come from the public route GET /packages,
// which offers only active products with a price (AC7, AC8), so this module never filters prices or computes one: the
// price, the price per credit and the saving are the server's, in satang (D173). The three tabs are the three credit
// types. Every word comes from the language files; a product's name and its price group's name are the club's own text.

export type CreditType = 'court_hour' | 'solo_class' | 'group_session';
export type Tab = 'court' | 'solo' | 'group';

export interface PublicProduct {
  productId: string;
  nameTh: string;
  nameEn: string;
  creditType: CreditType;
  credits: number;
  validityMonths: number;
  priceGroupId: string | null;
  coachTierId: string | null;
  priceSatang: number;
  pricePerCreditSatang: number;
  savingSatang: number | null;
  priceGroupNameTh: string | null;
  priceGroupNameEn: string | null;
}

export type Fetched<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

/** The tabs in board order with their label keys: Court bundles, Solo classes, Group classes. */
export const TABS: readonly { tab: Tab; creditType: CreditType; key: string }[] = [
  { tab: 'court', creditType: 'court_hour', key: 'P-0183' },
  { tab: 'solo', creditType: 'solo_class', key: 'P-0025' },
  { tab: 'group', creditType: 'group_session', key: 'P-0026' },
];

// The card's keys per credit type: the detail line, the price per credit and the saving (copy-index: C09, C09b, C09c).
const CARD: Record<CreditType, { detail: string; per: string; save: string; count: 'hours' | 'sessions'; perVar: 'pricePerHour' | 'pricePerClass' }> = {
  court_hour: { detail: 'P-0187', per: 'P-0188', save: 'P-0189', count: 'hours', perVar: 'pricePerHour' },
  solo_class: { detail: 'P-0295', per: 'P-0296', save: 'P-0297', count: 'sessions', perVar: 'pricePerClass' },
  group_session: { detail: 'P-0301', per: 'P-0302', save: 'P-0297', count: 'sessions', perVar: 'pricePerClass' },
};

export interface Card {
  productId: string;
  name: string;
  group: string | null;
  detail: string;
  price: string;
  perCredit: string;
  saving: string | null;
}

export function card(p: PublicProduct, lang: Lang, t: T): Card {
  const k = CARD[p.creditType];
  const group = lang === 'th' ? p.priceGroupNameTh : p.priceGroupNameEn;
  return {
    productId: p.productId,
    name: lang === 'th' ? p.nameTh : p.nameEn,
    group,
    detail: t(k.detail, { [k.count]: p.credits, validityMonths: p.validityMonths }),
    price: formatMoney(lang, p.priceSatang),
    perCredit: t(k.per, { [k.perVar]: formatMoney(lang, p.pricePerCreditSatang) }),
    saving: p.savingSatang !== null && p.savingSatang > 0 ? t(k.save, { saving: formatMoney(lang, p.savingSatang) }) : null,
  };
}

/** The products of one tab, in the server's order (credit type, credits, price). A product with no price is never
 *  offered (PKG-02-AC7): the route leaves it out, and so does the screen should one ever arrive. */
export function productsOf(products: readonly PublicProduct[], tab: Tab): PublicProduct[] {
  const type = TABS.find((x) => x.tab === tab)!.creditType;
  return products.filter((p) => p.creditType === type && typeof p.priceSatang === 'number');
}

/** The tab in the address (?tab=solo), so a link can open Solo or Group; Court bundles otherwise. */
export function tabFrom(search: string): Tab {
  const v = new URLSearchParams(search).get('tab');
  return v === 'solo' || v === 'group' ? v : 'court';
}

/** C10P package checkout for one product (F06-T19). */
export const buyPath = (slug: string, productId: string) => `${clubHome(slug)}/packages/${encodeURIComponent(productId)}`;

export async function loadProducts(slug: string, f: typeof fetch): Promise<Fetched<PublicProduct[]>> {
  try {
    const res = await f(`/api/c/${encodeURIComponent(slug)}/packages`, { credentials: 'same-origin', cache: 'no-store' });
    const body = (await res.json().catch(() => ({}))) as unknown;
    if (res.ok && Array.isArray(body)) return { ok: true, value: body as PublicProduct[] };
    const code = (body as { code?: unknown }).code;
    return { ok: false, status: res.status, code: typeof code === 'string' ? code : 'offline' };
  } catch {
    return { ok: false, status: 0, code: 'offline' };
  }
}
