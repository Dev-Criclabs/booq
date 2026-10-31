'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { formatBaht } from '../../client/admin/api';
import {
  addAddOn, addGroup, addOnBody, addOnDraft, addProduct, addTier, courtRuleOf, deleteAddOn, deleteGroup, deleteTier, groupBody, groupDraft, namesOk, perHourSatang, productBody, productDraft,
  resultKey, satangToBaht, saveAddOn, saveCourtRate, saveGroup, saveProduct, saveTier, saveTierPrice, tierPriceOf,
  type AddOn, type AddOnDraft, type CreditType, type GroupDraft, type NamesDraft, type PriceGroup, type Pricing, type Product, type ProductDraft,
} from '../../client/admin/pricing';
import { useAdmin } from './AdminFrame';

// A9 Products and pricing and A9b Price groups and add-ons (F11-T18; ADMIN-10, ADMIN-11): the owner's price data in cards. Each row saves on its own,
// sends only what changed and keeps what was typed when the server refuses. A price nobody set is an empty box: no default is ever shown or sent.
// Only the owner opens these pages (price.read and price.write); every change is audited by the server, and a change applies to new purchases only.

type Msg = { key: string; error: boolean } | null;
type Props = { data: Pricing; onChanged(): Promise<void> };

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const { t } = useAdmin();
  const note = (key: string | null) => setMsg(key === null ? { key: 'A-new.set_saved', error: false } : { key, error: true });
  const line = msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="price-msg">{t(msg.key)}</p> : null;
  return { busy, setBusy, note, line, clear: () => setMsg(null) };
}

const groupName = (g: PriceGroup, lang: string) => (lang === 'th' ? g.nameTh : g.nameEn);

// ---- court rate ------------------------------------------------------------------------------------------------------------------------------------
export function CourtRateCard({ data, onChanged }: Props) {
  const { slug, lang, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const s = useBusy();
  useEffect(() => setDrafts(Object.fromEntries(data.groups.map((g) => [g.id, satangToBaht(courtRuleOf(data.courtRules, g.id)?.priceSatang)]))), [data]);
  async function save(g: PriceGroup) {
    s.setBusy(true);
    const r = await saveCourtRate(slug, courtRuleOf(data.courtRules, g.id), g.id, drafts[g.id] ?? '', window.fetch.bind(window));
    s.setBusy(false);
    const k = resultKey(r);
    s.note(k);
    if (k === null) await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="price-court-rate" data-testid="price-court-rate">
      <h2 id="price-court-rate">{t('A-0230')}</h2>
      <p className="adm-muted">{t('A-0231')}</p>
      {data.groups.length === 0 ? <p className="adm-muted">{t('A-new.price_need_group')}</p> : null}
      {data.groups.map((g) => (
        <div key={g.id} className="adm-rule" data-testid={`rate-${g.id}`}>
          <label htmlFor={`rate-in-${g.id}`} className="adm-rule-label">{groupName(g, lang)}</label>
          <div className="adm-rule-control">
            <input id={`rate-in-${g.id}`} inputMode="decimal" value={drafts[g.id] ?? ''} disabled={s.busy} placeholder={t('A-new.price_not_set')} onChange={(e) => setDrafts({ ...drafts, [g.id]: e.target.value })} data-testid={`rate-in-${g.id}`} />
            <button type="button" className="adm-btn adm-btn-ghost" disabled={s.busy} onClick={() => void save(g)} data-testid={`rate-save-${g.id}`}>{t('A-0321')}</button>
          </div>
        </div>
      ))}
      {s.line}
    </section>
  );
}

// ---- package products (court bundles, solo packs, group packs) -------------------------------------------------------------------------------------
const TITLE: Record<CreditType, { head: string; add: string; credits: string }> = {
  court_hour: { head: 'A-0234', add: 'A-0235', credits: 'A-0237' },
  solo_class: { head: 'A-new.price_solo_packs', add: 'A-new.price_add_pack', credits: 'A-new.price_credits_classes' },
  group_session: { head: 'A-new.price_group_packs', add: 'A-new.price_add_pack', credits: 'A-new.price_credits_sessions' },
};

function ProductFields({ type, d, set, data, disabled, idp }: { type: CreditType; d: ProductDraft; set(p: Partial<ProductDraft>): void; data: Pricing; disabled: boolean; idp: string }) {
  const { lang, t } = useAdmin();
  return (
    <div className="adm-form">
      <label className="adm-field"><span>{t('A-new.price_name_th')}</span><input value={d.nameTh} disabled={disabled} onChange={(e) => set({ nameTh: e.target.value })} data-testid={`${idp}-nameTh`} /></label>
      <label className="adm-field"><span>{t('A-new.price_name_en')}</span><input value={d.nameEn} disabled={disabled} onChange={(e) => set({ nameEn: e.target.value })} data-testid={`${idp}-nameEn`} /></label>
      <label className="adm-field"><span>{t(TITLE[type].credits)}</span><input inputMode="numeric" value={d.credits} disabled={disabled} onChange={(e) => set({ credits: e.target.value })} data-testid={`${idp}-credits`} /></label>
      <label className="adm-field"><span>{t('A-0238')} · {t('A-new.price_months_unit')}</span><input inputMode="numeric" value={d.validityMonths} disabled={disabled} onChange={(e) => set({ validityMonths: e.target.value })} data-testid={`${idp}-months`} /></label>
      <label className="adm-field"><span>{t('A-0239')} · {t('A-new.price_baht_unit')}</span><input inputMode="decimal" value={d.price} placeholder={t('A-new.price_not_set')} disabled={disabled} onChange={(e) => set({ price: e.target.value })} data-testid={`${idp}-price`} /></label>
      {type !== 'court_hour' ? (
        <label className="adm-field"><span>{t('A-new.price_group_label')}</span>
          <select value={d.priceGroupId} disabled={disabled} onChange={(e) => set({ priceGroupId: e.target.value })} data-testid={`${idp}-group`}>
            <option value="">{t('A-new.price_pick')}</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{groupName(g, lang)}</option>)}
          </select>
        </label>
      ) : null}
      {type === 'solo_class' ? (
        <label className="adm-field"><span>{t('A-0182')}</span>
          <select value={d.coachTierId} disabled={disabled} onChange={(e) => set({ coachTierId: e.target.value })} data-testid={`${idp}-tier`}>
            <option value="">{t('A-new.price_pick')}</option>
            {data.tiers.map((x) => <option key={x.id} value={x.id}>{lang === 'th' ? x.nameTh : x.nameEn}</option>)}
          </select>
        </label>
      ) : null}
      <label className="adm-check"><input type="checkbox" checked={d.active} disabled={disabled} onChange={(e) => set({ active: e.target.checked })} data-testid={`${idp}-active`} /> {t('A-0241')}</label>
    </div>
  );
}

export function ProductsCard({ type, data, onChanged }: Props & { type: CreditType }) {
  const { slug, lang, t } = useAdmin();
  const list = data.products.filter((p) => p.creditType === type);
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({});
  const [fresh, setFresh] = useState<ProductDraft>(() => productDraft());
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(data.products.map((p) => [p.id, productDraft(p)]))), [data]);
  const say = (k: string, key: string | null) => setMsgs((m) => ({ ...m, [k]: key === null ? { key: 'A-new.set_saved', error: false } : { key, error: true } }));

  async function save(p: Product) {
    const body = productBody(type, p, drafts[p.id]!);
    if (!body.ok) return say(p.id, body.key);
    setBusy(true);
    const r = await saveProduct(slug, p.id, body.body, window.fetch.bind(window));
    setBusy(false);
    const k = resultKey(r);
    say(p.id, k);
    if (k === null) await onChanged();
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    const body = productBody(type, undefined, fresh);
    if (!body.ok) return say('new', body.key);
    setBusy(true);
    const r = await addProduct(slug, body.body, window.fetch.bind(window));
    setBusy(false);
    const k = resultKey(r);
    say('new', k);
    if (k === null) {
      setFresh(productDraft());
      await onChanged();
    }
  }
  const out = (m: Msg | undefined) => (m ? <p role={m.error ? 'alert' : 'status'} className={m.error ? 'adm-error' : 'adm-ok'} data-testid="price-msg">{t(m.key)}</p> : null);

  return (
    <section className="adm-card" aria-labelledby={`price-${type}`} data-testid={`price-products-${type}`}>
      <h2 id={`price-${type}`}>{t(TITLE[type].head)}</h2>
      {list.length === 0 ? <p className="adm-muted">{t('A-new.price_none')}</p> : null}
      {list.map((p) => {
        const d = drafts[p.id];
        if (!d) return null;
        const per = type === 'court_hour' ? perHourSatang(p) : null;
        return (
          <fieldset key={p.id} className="adm-court" data-testid={`product-${p.id}`}>
            <legend>{lang === 'th' ? p.nameTh : p.nameEn}</legend>
            <ProductFields type={type} d={d} set={(x) => setDrafts({ ...drafts, [p.id]: { ...d, ...x } })} data={data} disabled={busy} idp={`p-${p.id}`} />
            {per !== null ? <p className="adm-muted" data-testid={`per-hour-${p.id}`}>{t('A-0240')}: {formatBaht(per)}</p> : null}
            {out(msgs[p.id])}
            <button type="button" className="adm-btn" disabled={busy} onClick={() => void save(p)} data-testid={`p-${p.id}-save`}>{t('A-0321')}</button>
          </fieldset>
        );
      })}
      <form onSubmit={(e) => void add(e)} className="adm-court" noValidate data-testid={`product-new-${type}`}>
        <h3>{t(TITLE[type].add)}</h3>
        <ProductFields type={type} d={fresh} set={(x) => setFresh({ ...fresh, ...x })} data={data} disabled={busy} idp={`new-${type}`} />
        {out(msgs['new'])}
        <button type="submit" className="adm-btn" disabled={busy} data-testid={`new-${type}-add`}>{t(TITLE[type].add)}</button>
      </form>
    </section>
  );
}

// ---- coach tiers and their prices ------------------------------------------------------------------------------------------------------------------
function NamesRow({ d, set, disabled, idp }: { d: NamesDraft; set(p: Partial<NamesDraft>): void; disabled: boolean; idp: string }) {
  const { t } = useAdmin();
  return (
    <>
      <label className="adm-field"><span>{t('A-new.price_name_th')}</span><input value={d.nameTh} disabled={disabled} onChange={(e) => set({ nameTh: e.target.value })} data-testid={`${idp}-nameTh`} /></label>
      <label className="adm-field"><span>{t('A-new.price_name_en')}</span><input value={d.nameEn} disabled={disabled} onChange={(e) => set({ nameEn: e.target.value })} data-testid={`${idp}-nameEn`} /></label>
    </>
  );
}

export function TiersCard({ data, onChanged }: Props) {
  const { slug, lang, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, NamesDraft>>({});
  const [fresh, setFresh] = useState<NamesDraft>({ nameTh: '', nameEn: '' });
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(data.tiers.map((x) => [x.id, { nameTh: x.nameTh, nameEn: x.nameEn }]))), [data]);
  const say = (k: string, key: string | null) => setMsgs((m) => ({ ...m, [k]: key === null ? { key: 'A-new.set_saved', error: false } : { key, error: true } }));
  const out = (m: Msg | undefined) => (m ? <p role={m.error ? 'alert' : 'status'} className={m.error ? 'adm-error' : 'adm-ok'} data-testid="price-msg">{t(m.key)}</p> : null);
  async function run(k: string, d: NamesDraft, go: () => Promise<Parameters<typeof resultKey>[0]>, after?: () => void) {
    if (!namesOk(d)) return say(k, 'A-new.price_err_names');
    setBusy(true);
    const r = await go();
    setBusy(false);
    const key = resultKey(r);
    say(k, key);
    if (key === null) {
      after?.();
      await onChanged();
    }
  }
  return (
    <section className="adm-card" aria-labelledby="price-tiers" data-testid="price-tiers">
      <h2 id="price-tiers">{t('A-0228')}</h2>
      {data.tiers.length === 0 ? <p className="adm-muted">{t('A-new.price_none')}</p> : null}
      {data.tiers.map((x) => {
        const d = drafts[x.id];
        if (!d) return null;
        return (
          <fieldset key={x.id} className="adm-court" data-testid={`tier-${x.id}`}>
            <legend>{lang === 'th' ? x.nameTh : x.nameEn}</legend>
            <div className="adm-form"><NamesRow d={d} set={(p) => setDrafts({ ...drafts, [x.id]: { ...d, ...p } })} disabled={busy} idp={`t-${x.id}`} /></div>
            {out(msgs[x.id])}
            <span className="adm-inline">
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void run(x.id, d, () => saveTier(slug, x.id, d, window.fetch.bind(window)))} data-testid={`t-${x.id}-save`}>{t('A-0321')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t('A-new.price_confirm_delete'))) void run(x.id, d, () => deleteTier(slug, x.id, window.fetch.bind(window))); }} data-testid={`t-${x.id}-delete`}>{t('A-new.price_delete')}</button>
            </span>
          </fieldset>
        );
      })}
      <form onSubmit={(e) => { e.preventDefault(); void run('new', fresh, () => addTier(slug, fresh, window.fetch.bind(window)), () => setFresh({ nameTh: '', nameEn: '' })); }} className="adm-court" noValidate data-testid="tier-new">
        <h3>{t('A-new.price_add_tier')}</h3>
        <div className="adm-form"><NamesRow d={fresh} set={(p) => setFresh({ ...fresh, ...p })} disabled={busy} idp="new-tier" /></div>
        {out(msgs['new'])}
        <button type="submit" className="adm-btn" disabled={busy} data-testid="new-tier-add">{t('A-new.price_add_tier')}</button>
      </form>
    </section>
  );
}

/**
 * A solo class is the coach tier's price plus the normal court price (two order lines), so the court part is the court rate of the price group, edited on
 * the Courts tab. This card only reads: per price group, the court part and, for each tier, what a player sees (coaching + court).
 */
export function CourtPartCard({ data, onGoCourts }: { data: Pricing; onGoCourts(): void }) {
  const { lang, t } = useAdmin();
  if (data.groups.length === 0) return null;
  return (
    <section className="adm-card" aria-labelledby="price-court-part" data-testid="price-court-part">
      <h2 id="price-court-part">{t('A-0232')}</h2>
      <p className="adm-muted">{t('A-0233')}</p>
      {data.groups.map((g) => {
        const court = courtRuleOf(data.courtRules, g.id)?.priceSatang ?? null;
        return (
          <div key={g.id} className="adm-rule" data-testid={`part-${g.id}`}>
            <p className="adm-rule-label">{groupName(g, lang)} · {court === null ? t('A-new.price_not_set') : formatBaht(court)}</p>
            {data.tiers.map((x) => {
              const coach = tierPriceOf(data.tierPrices, x.id, g.id);
              return (
                <p key={x.id} className="adm-muted" data-testid={`preview-${x.id}-${g.id}`}>
                  {lang === 'th' ? x.nameTh : x.nameEn}: {coach === null || court === null ? t('A-new.price_preview_unset') : t('A-0250', { price: formatBaht(coach), courtPrice: formatBaht(court) })}
                </p>
              );
            })}
          </div>
        );
      })}
      <button type="button" className="adm-btn adm-btn-ghost" onClick={onGoCourts} data-testid="part-go">{t('A-new.price_edit_court_prices')}</button>
    </section>
  );
}

/** The coaching price of each tier for each price group; an empty box is "not set" and the coach cannot be picked for that group. */
export function TierPricesCard({ data, onChanged }: Props) {
  const { slug, lang, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const s = useBusy();
  const id = (tier: string, g: string) => `${tier}:${g}`;
  useEffect(() => setDrafts(Object.fromEntries(data.tiers.flatMap((x) => data.groups.map((g) => [id(x.id, g.id), satangToBaht(tierPriceOf(data.tierPrices, x.id, g.id))])))), [data]);
  async function save(tier: string, g: string) {
    s.setBusy(true);
    const r = await saveTierPrice(slug, tier, g, tierPriceOf(data.tierPrices, tier, g), drafts[id(tier, g)] ?? '', window.fetch.bind(window));
    s.setBusy(false);
    const k = resultKey(r);
    s.note(k);
    if (k === null) await onChanged();
  }
  if (data.tiers.length === 0 || data.groups.length === 0) return null;
  return (
    <section className="adm-card" aria-labelledby="price-tier-prices" data-testid="price-tier-prices">
      <h2 id="price-tier-prices">{t('A-new.price_tier_prices')}</h2>
      <p className="adm-muted">{t('A-new.price_tier_prices_hint')}</p>
      {data.tiers.map((x) => (
        <div key={x.id} data-testid={`tp-${x.id}`}>
          <h3>{lang === 'th' ? x.nameTh : x.nameEn}</h3>
          {data.groups.map((g) => (
            <div key={g.id} className="adm-rule">
              <label htmlFor={`tp-in-${x.id}-${g.id}`} className="adm-rule-label">{groupName(g, lang)}</label>
              <div className="adm-rule-control">
                <input id={`tp-in-${x.id}-${g.id}`} inputMode="decimal" value={drafts[id(x.id, g.id)] ?? ''} placeholder={t('A-new.price_not_set')} disabled={s.busy} onChange={(e) => setDrafts({ ...drafts, [id(x.id, g.id)]: e.target.value })} data-testid={`tp-in-${x.id}-${g.id}`} />
                <button type="button" className="adm-btn adm-btn-ghost" disabled={s.busy} onClick={() => void save(x.id, g.id)} data-testid={`tp-save-${x.id}-${g.id}`}>{t('A-0321')}</button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {s.line}
    </section>
  );
}

// ---- price groups (A9b) ----------------------------------------------------------------------------------------------------------------------------
function GroupFields({ d, set, disabled, idp }: { d: GroupDraft; set(p: Partial<GroupDraft>): void; disabled: boolean; idp: string }) {
  const { t } = useAdmin();
  return (
    <div className="adm-form">
      <NamesRow d={d} set={set} disabled={disabled} idp={idp} />
      <label className="adm-field"><span>{t('A-new.price_age_from')}</span><input inputMode="numeric" value={d.minAge} disabled={disabled} onChange={(e) => set({ minAge: e.target.value })} data-testid={`${idp}-minAge`} /></label>
      <label className="adm-field"><span>{t('A-new.price_age_to')}</span><input inputMode="numeric" value={d.maxAge} disabled={disabled} onChange={(e) => set({ maxAge: e.target.value })} data-testid={`${idp}-maxAge`} /></label>
    </div>
  );
}

export function GroupsCard({ data, onChanged }: Props) {
  const { slug, lang, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, GroupDraft>>({});
  const [fresh, setFresh] = useState<GroupDraft>(() => groupDraft());
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(data.groups.map((g) => [g.id, groupDraft(g)]))), [data]);
  const say = (k: string, key: string | null) => setMsgs((m) => ({ ...m, [k]: key === null ? { key: 'A-new.set_saved', error: false } : { key, error: true } }));
  const out = (m: Msg | undefined) => (m ? <p role={m.error ? 'alert' : 'status'} className={m.error ? 'adm-error' : 'adm-ok'} data-testid="price-msg">{t(m.key)}</p> : null);
  async function save(g: PriceGroup | undefined, d: GroupDraft, k: string) {
    const body = groupBody(g, d);
    if (!body.ok) return say(k, body.key);
    setBusy(true);
    const r = g ? await saveGroup(slug, g.id, body.body, window.fetch.bind(window)) : await addGroup(slug, body.body, window.fetch.bind(window));
    setBusy(false);
    const key = resultKey(r);
    say(k, key);
    if (key === null) {
      if (!g) setFresh(groupDraft());
      await onChanged();
    }
  }
  async function remove(g: PriceGroup) {
    setBusy(true);
    const r = await deleteGroup(slug, g.id, window.fetch.bind(window));
    setBusy(false);
    const key = resultKey(r);
    say(g.id, key);
    if (key === null) await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="price-groups" data-testid="price-groups">
      <h2 id="price-groups">{t('A-new.price_groups_title')}</h2>
      <p className="adm-muted">{t('A-new.price_groups_hint')}</p>
      {data.groups.length === 0 ? <p className="adm-muted">{t('A-new.price_none')}</p> : null}
      {data.groups.map((g) => {
        const d = drafts[g.id];
        if (!d) return null;
        return (
          <fieldset key={g.id} className="adm-court" data-testid={`group-${g.id}`}>
            <legend>{groupName(g, lang)}</legend>
            <GroupFields d={d} set={(p) => setDrafts({ ...drafts, [g.id]: { ...d, ...p } })} disabled={busy} idp={`g-${g.id}`} />
            {out(msgs[g.id])}
            <span className="adm-inline">
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void save(g, d, g.id)} data-testid={`g-${g.id}-save`}>{t('A-0321')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t('A-new.price_confirm_delete'))) void remove(g); }} data-testid={`g-${g.id}-delete`}>{t('A-new.price_delete')}</button>
            </span>
          </fieldset>
        );
      })}
      <form onSubmit={(e) => { e.preventDefault(); void save(undefined, fresh, 'new'); }} className="adm-court" noValidate data-testid="group-new">
        <h3>{t('A-new.price_add_group')}</h3>
        <GroupFields d={fresh} set={(p) => setFresh({ ...fresh, ...p })} disabled={busy} idp="new-group" />
        {out(msgs['new'])}
        <button type="submit" className="adm-btn" disabled={busy} data-testid="new-group-add">{t('A-new.price_add_group')}</button>
      </form>
    </section>
  );
}

// ---- add-ons (A9b) ---------------------------------------------------------------------------------------------------------------------------------
function AddOnFields({ d, set, disabled, idp }: { d: AddOnDraft; set(p: Partial<AddOnDraft>): void; disabled: boolean; idp: string }) {
  const { t } = useAdmin();
  return (
    <div className="adm-form">
      <NamesRow d={d} set={set} disabled={disabled} idp={idp} />
      <label className="adm-field"><span>{t('A-0546')} · {t('A-new.price_baht_unit')}</span><input inputMode="decimal" value={d.price} placeholder={t('A-new.price_not_set')} disabled={disabled} onChange={(e) => set({ price: e.target.value })} data-testid={`${idp}-price`} /></label>
      <label className="adm-check"><input type="checkbox" checked={d.active} disabled={disabled} onChange={(e) => set({ active: e.target.checked })} data-testid={`${idp}-active`} /> {t('A-0547')}</label>
    </div>
  );
}

export function AddOnsCard({ data, onChanged }: Props) {
  const { slug, lang, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, AddOnDraft>>({});
  const [fresh, setFresh] = useState<AddOnDraft>(() => addOnDraft());
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDrafts(Object.fromEntries(data.addOns.map((a) => [a.id, addOnDraft(a)]))), [data]);
  const say = (k: string, key: string | null) => setMsgs((m) => ({ ...m, [k]: key === null ? { key: 'A-new.set_saved', error: false } : { key, error: true } }));
  const out = (m: Msg | undefined) => (m ? <p role={m.error ? 'alert' : 'status'} className={m.error ? 'adm-error' : 'adm-ok'} data-testid="price-msg">{t(m.key)}</p> : null);
  async function save(a: AddOn | undefined, d: AddOnDraft, k: string) {
    const body = addOnBody(a, d);
    if (!body.ok) return say(k, body.key);
    setBusy(true);
    const r = a ? await saveAddOn(slug, a.id, body.body, window.fetch.bind(window)) : await addAddOn(slug, body.body, window.fetch.bind(window));
    setBusy(false);
    const key = resultKey(r);
    say(k, key);
    if (key === null) {
      if (!a) setFresh(addOnDraft());
      await onChanged();
    }
  }
  async function remove(a: AddOn) {
    setBusy(true);
    const r = await deleteAddOn(slug, a.id, window.fetch.bind(window));
    setBusy(false);
    const key = resultKey(r);
    say(a.id, key);
    if (key === null) await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="price-addons" data-testid="price-addons">
      <h2 id="price-addons">{t('A-new.price_addons_title')}</h2>
      <p className="adm-muted">{t('A-new.price_addons_hint')}</p>
      {data.addOns.length === 0 ? <p className="adm-muted">{t('A-new.price_none')}</p> : null}
      {data.addOns.map((a) => {
        const d = drafts[a.id];
        if (!d) return null;
        return (
          <fieldset key={a.id} className="adm-court" data-testid={`addon-${a.id}`}>
            <legend>{lang === 'th' ? a.nameTh : a.nameEn}</legend>
            <AddOnFields d={d} set={(p) => setDrafts({ ...drafts, [a.id]: { ...d, ...p } })} disabled={busy} idp={`a-${a.id}`} />
            {out(msgs[a.id])}
            <span className="adm-inline">
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void save(a, d, a.id)} data-testid={`a-${a.id}-save`}>{t('A-0321')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t('A-new.price_confirm_delete'))) void remove(a); }} data-testid={`a-${a.id}-delete`}>{t('A-new.price_delete')}</button>
            </span>
          </fieldset>
        );
      })}
      <form onSubmit={(e) => { e.preventDefault(); void save(undefined, fresh, 'new'); }} className="adm-court" noValidate data-testid="addon-new">
        <h3>{t('A-new.price_add_addon')}</h3>
        <AddOnFields d={fresh} set={(p) => setFresh({ ...fresh, ...p })} disabled={busy} idp="new-addon" />
        {out(msgs['new'])}
        <button type="submit" className="adm-btn" disabled={busy} data-testid="new-addon-add">{t('A-new.price_add_addon')}</button>
      </form>
    </section>
  );
}
