'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatBaht } from '../../client/admin/api';
import {
  addPartner, addPromo, APPLIES, APPLIES_KEY, AUDIENCE_KEY, AUDIENCES, deletePartner, deletePromo, discountText, loadPromos, partnerBody, partnerDraft, promoBody, promoDraft, promoErrorKey, savePartner, savePromo,
  type Partner, type PartnerDraft, type Promo, type PromoDraft,
} from '../../client/admin/promos';
import { useAdmin } from './AdminFrame';

// A10 Promotions (F11-T19; ADMIN-12; board H-A10-Promotions): promo codes and partners, the owner only (price.read, price.write). One code per order is the
// checkout's rule (A-0251). Each code has its own audience, caps, minimum spend and whether it stacks with the birthday discount (A-0270). Every change is
// audited by the server and applies to new orders only. Not drawn: how many times a code was used (no route returns it), Refer a friend (waits for F14) and
// the birthday month discount (its setting is on Settings).

type Msg = { key: string; error: boolean } | null;
type Load = { kind: 'loading' } | { kind: 'ready'; promos: Promo[]; partners: Partner[] } | { kind: 'error' } | { kind: 'forbidden' };

export function PromotionsScreen() {
  const { slug, t } = useAdmin();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const reload = useCallback(async () => {
    const r = await loadPromos(slug, window.fetch.bind(window));
    if (r.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    setLoad(r.kind === 'ok' ? { kind: 'ready', promos: r.body.promos, partners: r.body.partners } : { kind: 'error' });
  }, [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);
  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') return <p role="alert" data-testid="promo-forbidden">{t('A-new.promo_err_forbidden')}</p>;
  if (load.kind === 'error') return <div role="alert" data-testid="promo-error"><p>{t('A-new.promo_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.set_retry')}</button></div>;
  return (
    <div data-testid="promotions-page">
      <header className="adm-head"><h1>{t('A-0161')}</h1></header>
      <p className="adm-muted">{t('A-0251')}</p>
      <p className="adm-muted">{t('A-0270')}</p>
      <CodesCard promos={load.promos} partners={load.partners} onChanged={reload} />
      <PartnersCard partners={load.partners} onChanged={reload} />
    </div>
  );
}

function useMsgs() {
  const { t } = useAdmin();
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});
  const say = (k: string, key: string | null) => setMsgs((m) => ({ ...m, [k]: key === null ? { key: 'A-new.set_saved', error: false } : { key, error: true } }));
  const out = (k: string) => (msgs[k] ? <p role={msgs[k]!.error ? 'alert' : 'status'} className={msgs[k]!.error ? 'adm-error' : 'adm-ok'} data-testid="promo-msg">{t(msgs[k]!.key)}</p> : null);
  return { say, out };
}

function CodeFields({ d, set, partners, disabled, idp }: { d: PromoDraft; set(p: Partial<PromoDraft>): void; partners: Partner[]; disabled: boolean; idp: string }) {
  const { t } = useAdmin();
  const toggle = (a: (typeof APPLIES)[number]) => set({ appliesTo: d.appliesTo.includes(a) ? d.appliesTo.filter((x) => x !== a) : [...d.appliesTo, a] });
  return (
    <div className="adm-form">
      <label className="adm-field"><span>{t('A-0255')}</span><input value={d.code} disabled={disabled} autoCapitalize="characters" onChange={(e) => set({ code: e.target.value })} data-testid={`${idp}-code`} /></label>
      <label className="adm-field"><span>{t('A-0256')}</span>
        <select value={d.kind} disabled={disabled} onChange={(e) => set({ kind: e.target.value as PromoDraft['kind'] })} data-testid={`${idp}-kind`}>
          <option value="percent">{t('A-new.promo_kind_percent')}</option><option value="fixed">{t('A-new.promo_kind_fixed')}</option>
        </select>
      </label>
      <label className="adm-field"><span>{t(d.kind === 'percent' ? 'A-new.promo_amount_percent' : 'A-new.promo_amount_baht')}</span><input inputMode="decimal" value={d.amount} disabled={disabled} onChange={(e) => set({ amount: e.target.value })} data-testid={`${idp}-amount`} /></label>
      <fieldset className="adm-field" disabled={disabled}>
        <legend>{t('A-0257')}</legend>
        {APPLIES.map((a) => <label key={a} className="adm-check"><input type="checkbox" checked={d.appliesTo.includes(a)} onChange={() => toggle(a)} data-testid={`${idp}-applies-${a}`} /> {t(APPLIES_KEY[a])}</label>)}
      </fieldset>
      <label className="adm-check"><input type="checkbox" checked={d.includesAddOns} disabled={disabled} onChange={(e) => set({ includesAddOns: e.target.checked })} data-testid={`${idp}-addons`} /> {t('A-new.promo_includes_add_ons')}</label>
      <label className="adm-field"><span>{t('A-0258')}</span>
        <select value={d.audience} disabled={disabled} onChange={(e) => set({ audience: e.target.value as PromoDraft['audience'] })} data-testid={`${idp}-audience`}>
          {AUDIENCES.map((a) => <option key={a} value={a}>{t(AUDIENCE_KEY[a])}</option>)}
        </select>
      </label>
      <label className="adm-field"><span>{t('A-new.promo_starts')}</span><input type="date" value={d.startsOn} disabled={disabled} onChange={(e) => set({ startsOn: e.target.value })} data-testid={`${idp}-starts`} /></label>
      <label className="adm-field"><span>{t('A-new.promo_ends')}</span><input type="date" value={d.endsOn} disabled={disabled} onChange={(e) => set({ endsOn: e.target.value })} data-testid={`${idp}-ends`} /></label>
      <label className="adm-check"><input type="checkbox" checked={d.firstTimeOnly} disabled={disabled} onChange={(e) => set({ firstTimeOnly: e.target.checked })} data-testid={`${idp}-first`} /> {t('A-0264')}</label>
      <label className="adm-field"><span>{t('A-new.promo_total_cap')}</span><input inputMode="numeric" value={d.totalCap} disabled={disabled} onChange={(e) => set({ totalCap: e.target.value })} data-testid={`${idp}-total`} /></label>
      <label className="adm-field"><span>{t('A-new.promo_per_customer_cap')}</span><input inputMode="numeric" value={d.perCustomerCap} disabled={disabled} onChange={(e) => set({ perCustomerCap: e.target.value })} data-testid={`${idp}-per`} /></label>
      <label className="adm-field"><span>{t('A-new.promo_min_spend')}</span><input inputMode="decimal" value={d.minSpend} disabled={disabled} onChange={(e) => set({ minSpend: e.target.value })} data-testid={`${idp}-spend`} /></label>
      <label className="adm-check"><input type="checkbox" checked={d.stackableWithBirthday} disabled={disabled} onChange={(e) => set({ stackableWithBirthday: e.target.checked })} data-testid={`${idp}-stack`} /> {t('A-new.promo_stackable')}</label>
      <label className="adm-field"><span>{t('A-0261')}</span>
        <select value={d.partnerId} disabled={disabled} onChange={(e) => set({ partnerId: e.target.value })} data-testid={`${idp}-partner`}>
          <option value="">{t('A-new.promo_no_partner')}</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="adm-check"><input type="checkbox" checked={d.active} disabled={disabled} onChange={(e) => set({ active: e.target.checked })} data-testid={`${idp}-active`} /> {t('A-new.promo_active')}</label>
    </div>
  );
}

function CodesCard({ promos, partners, onChanged }: { promos: Promo[]; partners: Partner[]; onChanged(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, PromoDraft>>({});
  const [fresh, setFresh] = useState<PromoDraft>(() => promoDraft());
  const [busy, setBusy] = useState(false);
  const { say, out } = useMsgs();
  useEffect(() => setDrafts(Object.fromEntries(promos.map((p) => [p.id, promoDraft(p)]))), [promos]);

  async function save(p: Promo | undefined, d: PromoDraft, k: string) {
    const body = promoBody(p, d);
    if (!body.ok) return say(k, body.key);
    setBusy(true);
    const r = p ? await savePromo(slug, p.id, body.body, window.fetch.bind(window)) : await addPromo(slug, body.body, window.fetch.bind(window));
    setBusy(false);
    const key = promoErrorKey(r);
    say(k, key);
    if (key === null) {
      if (!p) setFresh(promoDraft());
      await onChanged();
    }
  }
  async function remove(p: Promo) {
    setBusy(true);
    const r = await deletePromo(slug, p.id, window.fetch.bind(window));
    setBusy(false);
    const key = promoErrorKey(r);
    say(p.id, key);
    if (key === null) await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="promo-codes" data-testid="promo-codes">
      <h2 id="promo-codes">{t('A-0253')}</h2>
      {promos.length === 0 ? <p className="adm-muted">{t('A-new.promo_none')}</p> : null}
      {promos.map((p) => {
        const d = drafts[p.id];
        if (!d) return null;
        const disc = discountText(p);
        return (
          <fieldset key={p.id} className="adm-court" data-testid={`promo-${p.id}`}>
            <legend>{p.code} · {'percent' in disc ? t('A-0267', { percent: disc.percent }) : t('A-0262', { amount: formatBaht(disc.satang) })}</legend>
            <CodeFields d={d} set={(x) => setDrafts({ ...drafts, [p.id]: { ...d, ...x } })} partners={partners} disabled={busy} idp={`c-${p.id}`} />
            {out(p.id)}
            <span className="adm-inline">
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void save(p, d, p.id)} data-testid={`c-${p.id}-save`}>{t('A-0321')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t('A-new.promo_confirm_delete'))) void remove(p); }} data-testid={`c-${p.id}-delete`}>{t('A-new.promo_delete')}</button>
            </span>
          </fieldset>
        );
      })}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void save(undefined, fresh, 'new'); }} className="adm-court" noValidate data-testid="promo-new">
        <h3>{t('A-0252')}</h3>
        <CodeFields d={fresh} set={(x) => setFresh({ ...fresh, ...x })} partners={partners} disabled={busy} idp="new" />
        {out('new')}
        <button type="submit" className="adm-btn" disabled={busy} data-testid="new-add">{t('A-0252')}</button>
      </form>
    </section>
  );
}

function PartnerFields({ d, set, disabled, idp }: { d: PartnerDraft; set(p: Partial<PartnerDraft>): void; disabled: boolean; idp: string }) {
  const { t } = useAdmin();
  return (
    <div className="adm-form">
      <label className="adm-field"><span>{t('A-new.promo_partner_name')}</span><input value={d.name} disabled={disabled} onChange={(e) => set({ name: e.target.value })} data-testid={`${idp}-name`} /></label>
      <label className="adm-field"><span>{t('A-new.promo_partner_type')}</span><input value={d.type} disabled={disabled} onChange={(e) => set({ type: e.target.value })} data-testid={`${idp}-type`} /></label>
      <label className="adm-field"><span>{t('A-new.promo_partner_contact')}</span><input value={d.contact} disabled={disabled} onChange={(e) => set({ contact: e.target.value })} data-testid={`${idp}-contact`} /></label>
    </div>
  );
}

function PartnersCard({ partners, onChanged }: { partners: Partner[]; onChanged(): Promise<void> }) {
  const { slug, t } = useAdmin();
  const [drafts, setDrafts] = useState<Record<string, PartnerDraft>>({});
  const [fresh, setFresh] = useState<PartnerDraft>(() => partnerDraft());
  const [busy, setBusy] = useState(false);
  const { say, out } = useMsgs();
  useEffect(() => setDrafts(Object.fromEntries(partners.map((p) => [p.id, partnerDraft(p)]))), [partners]);
  async function save(p: Partner | undefined, d: PartnerDraft, k: string) {
    const body = partnerBody(p, d);
    if (!body.ok) return say(k, body.key);
    setBusy(true);
    const r = p ? await savePartner(slug, p.id, body.body, window.fetch.bind(window)) : await addPartner(slug, body.body, window.fetch.bind(window));
    setBusy(false);
    const key = promoErrorKey(r);
    say(k, key);
    if (key === null) {
      if (!p) setFresh(partnerDraft());
      await onChanged();
    }
  }
  async function remove(p: Partner) {
    setBusy(true);
    const r = await deletePartner(slug, p.id, window.fetch.bind(window));
    setBusy(false);
    const key = promoErrorKey(r);
    say(p.id, key);
    if (key === null) await onChanged();
  }
  return (
    <section className="adm-card" aria-labelledby="promo-partners" data-testid="promo-partners">
      <h2 id="promo-partners">{t('A-0254', { count: partners.length })}</h2>
      {partners.length === 0 ? <p className="adm-muted">{t('A-new.promo_none_partners')}</p> : null}
      {partners.map((p) => {
        const d = drafts[p.id];
        if (!d) return null;
        return (
          <fieldset key={p.id} className="adm-court" data-testid={`partner-${p.id}`}>
            <legend>{p.name}</legend>
            <PartnerFields d={d} set={(x) => setDrafts({ ...drafts, [p.id]: { ...d, ...x } })} disabled={busy} idp={`p-${p.id}`} />
            {out(p.id)}
            <span className="adm-inline">
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void save(p, d, p.id)} data-testid={`p-${p.id}-save`}>{t('A-0321')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => { if (window.confirm(t('A-new.promo_confirm_delete'))) void remove(p); }} data-testid={`p-${p.id}-delete`}>{t('A-new.promo_delete')}</button>
            </span>
          </fieldset>
        );
      })}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void save(undefined, fresh, 'new'); }} className="adm-court" noValidate data-testid="partner-new">
        <h3>{t('A-new.promo_add_partner')}</h3>
        <PartnerFields d={fresh} set={(x) => setFresh({ ...fresh, ...x })} disabled={busy} idp="new-partner" />
        {out('new')}
        <button type="submit" className="adm-btn" disabled={busy} data-testid="new-partner-add">{t('A-new.promo_add_partner')}</button>
      </form>
    </section>
  );
}
