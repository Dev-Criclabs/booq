'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatBaht } from '../../client/admin/api';
import {
  addTag, BOOKING_STATUS_KEY, BOOKING_TYPE_KEY, bookingWhat, LEVEL_KEY, loadBookings, loadNotes, loadOrders, loadProfile, loadValue, nextPackage, ORDER_KIND_KEY, packageName, recent, removeTag, visits,
  type BookingRow, type Note, type OrderRow, type Profile, type Value,
} from '../../client/admin/profile';
import { adminPath, dayMonthOf } from '../../client/admin/shell';
import { dateOf, longDayOf, timeOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';
import { AdjustPanel, ExtendPanel, NotesPanel } from './ProfileActions';

// A6 Customer profile (F11-T15; ADMIN-07; board H-A06-Customer-profile): who the customer is, tags, and the tabs Overview, Bookings, Purchases and
// Credits and wallet. Overview holds the tiles, the latest bookings, staff notes, Adjust balance and Extend package (owner only). The Referrals tab
// waits for F14 (no route yet) and the Receipts tab for a receipts-by-customer route (GET /staff/receipts has no customer filter), so neither is
// drawn; receipt numbers show on each purchase. Value changes are ledger rows with a written reason; this page only sends a change and a reason.

type Tab = 'overview' | 'bookings' | 'purchases' | 'credits';
const TABS: ReadonlyArray<{ id: Tab; key: string }> = [
  { id: 'overview', key: 'A-0097' }, { id: 'bookings', key: 'A-0098' }, { id: 'purchases', key: 'A-0099' }, { id: 'credits', key: 'A-0100' },
];
type Head = { kind: 'loading' } | { kind: 'ready'; profile: Profile } | { kind: 'not_found' } | { kind: 'forbidden' } | { kind: 'error' };

export function CustomerProfileScreen({ id }: { id: string }) {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [head, setHead] = useState<Head>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('overview');
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [value, setValue] = useState<Value | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState('');
  const [tagMsg, setTagMsg] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const loadAll = useCallback(async () => {
    const [p, b, v, n] = await Promise.all([loadProfile(slug, id, f()), loadBookings(slug, id, f()), loadValue(slug, id, f()), loadNotes(slug, id, f())]);
    if (p.kind === 'ok') setHead({ kind: 'ready', profile: p.body });
    else setHead({ kind: p.kind === 'not_found' ? 'not_found' : p.kind === 'forbidden' ? 'forbidden' : 'error' });
    if (b.kind === 'ok') setBookings(b.body);
    if (v.kind === 'ok') setValue(v.body);
    if (n.kind === 'ok') setNotes(n.body);
  }, [slug, id]);
  useEffect(() => {
    void loadAll();
  }, [loadAll, attempt]);
  useEffect(() => {
    if (tab === 'purchases' && orders === null) void loadOrders(slug, id, f()).then((o) => o.kind === 'ok' && setOrders(o.body));
  }, [tab, orders, slug, id]);

  const reloadValue = async () => {
    const [v, n] = await Promise.all([loadValue(slug, id, f()), loadNotes(slug, id, f())]);
    if (v.kind === 'ok') setValue(v.body);
    if (n.kind === 'ok') setNotes(n.body);
  };
  async function changeTag(name: string, on: boolean) {
    const r = on ? await addTag(slug, id, name, f()) : await removeTag(slug, id, name, f());
    if (r.kind !== 'ok') return setTagMsg('A-new.prof_err_general');
    setTagMsg(null);
    setTag('');
    setAdding(false);
    const p = await loadProfile(slug, id, f());
    if (p.kind === 'ok') setHead({ kind: 'ready', profile: p.body });
  }

  const back = <p><a href={adminPath(slug, 'customers')} data-testid="prof-back">{t('A-0094')}</a></p>;
  if (head.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (head.kind === 'not_found') return <>{back}<p role="alert" data-testid="prof-not-found">{t('A-new.prof_not_found')}</p></>;
  if (head.kind === 'forbidden') return <>{back}<p role="alert" data-testid="prof-forbidden">{t('A-new.prof_forbidden')}</p></>;
  if (head.kind === 'error') {
    return <>{back}<div role="alert" data-testid="prof-error"><p>{t('A-new.prof_load_failed')}</p><button type="button" className="adm-btn" onClick={() => setAttempt((n) => n + 1)}>{t('A-new.cust_retry')}</button></div></>;
  }

  const p = head.profile;
  const name = (p.fullName ?? p.displayName ?? '').trim();
  const meta = [p.phone, p.dateOfBirth ? t('A-new.prof_born', { dateOfBirth: longDayOf(lang, p.dateOfBirth) }) : null, p.level && LEVEL_KEY[p.level] ? t(LEVEL_KEY[p.level]!) : null]
    .filter((x): x is string => !!x).join(' · ');
  const v = visits(bookings ?? [], new Date());
  const pkg = nextPackage(value?.packages ?? []);

  return (
    <section data-testid="profile" aria-labelledby="prof-title">
      {back}
      <header className="adm-prof-head">
        <h1 id="prof-title" data-testid="prof-name">{name || t('A-new.cust_no_name')}</h1>
        <p className="adm-muted" data-testid="prof-meta">{meta}</p>
        {p.claimState === 'unclaimed' ? <p className="adm-muted">{t('A-new.prof_unclaimed_note')}</p> : null}
        <div className="adm-chips" data-testid="prof-tags">
          {p.tags.map((x) => (
            <span key={x} className="adm-chip">{x}<button type="button" className="adm-chip-x" aria-label={t('A-new.prof_tag_remove', { tag: x })} onClick={() => void changeTag(x, false)} data-testid={`tag-remove-${x}`}>×</button></span>
          ))}
          {adding ? (
            <form className="adm-inline" onSubmit={(e) => { e.preventDefault(); if (tag.trim()) void changeTag(tag, true); }}>
              <input value={tag} maxLength={40} aria-label={t('A-new.prof_tag_input')} placeholder={t('A-new.prof_tag_input')} onChange={(e) => setTag(e.target.value)} data-testid="tag-input" />
              <button type="submit" className="adm-btn adm-btn-ghost" data-testid="tag-save">{t('A-new.prof_tag_add')}</button>
            </form>
          ) : <button type="button" className="adm-chip adm-chip-add" onClick={() => setAdding(true)} data-testid="tag-add">{t('A-0096')}</button>}
        </div>
        {tagMsg ? <p role="alert" className="adm-error">{t(tagMsg)}</p> : null}
      </header>

      <div role="tablist" aria-label={t('A-new.prof_tabs_label')} className="adm-tabs">
        {TABS.map((x) => <button key={x.id} role="tab" type="button" aria-selected={tab === x.id} onClick={() => setTab(x.id)} data-testid={`tab-${x.id}`}>{t(x.key)}</button>)}
      </div>

      {tab === 'overview' ? (
        <div data-testid="panel-overview">
          <div className="adm-tiles">
            <div className="adm-tile" data-testid="tile-wallet"><p className="adm-tile-label">{t('A-0055')}</p><p className="adm-tile-value">{formatBaht(value?.wallet.balanceSatang ?? 0)}</p></div>
            <div className="adm-tile" data-testid="tile-package">
              <p className="adm-tile-label">{pkg ? packageName(pkg, lang) : t('A-0100')}</p>
              <p className="adm-tile-value">{pkg ? t('A-new.prof_credits_left', { left: pkg.creditsLeft, total: pkg.creditsTotal }) : t('A-new.prof_no_package')}</p>
              {pkg ? <p className="adm-muted">{t('A-0106', { dayMonthYear: longDayOf(lang, pkg.expiresAt) })}</p> : null}
            </div>
            <div className="adm-tile" data-testid="tile-visits"><p className="adm-tile-label">{t('A-0107')}</p><p className="adm-tile-value">{v.count}</p>{v.since ? <p className="adm-muted">{t('A-0108', { dayMonth: dayMonthOf(lang, v.since) })}</p> : null}</div>
          </div>
          <section className="adm-card" aria-labelledby="prof-recent">
            <h2 id="prof-recent">{t('A-0109')}</h2>
            {bookings && bookings.length > 0 ? <BookingList rows={recent(bookings)} /> : <p className="adm-muted">{t('A-new.prof_bookings_empty')}</p>}
          </section>
          <NotesPanel id={id} notes={notes} onChanged={reloadValue} />
          <div className="adm-two">
            <AdjustPanel id={id} value={value} onChanged={reloadValue} />
            <ExtendPanel value={value} onChanged={reloadValue} />
          </div>
        </div>
      ) : null}

      {tab === 'bookings' ? <div data-testid="panel-bookings">{bookings && bookings.length > 0 ? <BookingTable rows={bookings} /> : <p className="adm-muted">{t('A-new.prof_bookings_empty')}</p>}</div> : null}
      {tab === 'purchases' ? <div data-testid="panel-purchases">{orders === null ? <p aria-busy="true" className="adm-muted">…</p> : orders.length > 0 ? <OrderTable rows={orders} /> : <p className="adm-muted">{t('A-new.prof_orders_empty')}</p>}</div> : null}
      {tab === 'credits' ? <div data-testid="panel-credits"><ValuePanel value={value} /></div> : null}
    </section>
  );
}

function bookingLine(b: BookingRow, lang: 'th' | 'en', t: (k: string, v?: Record<string, string | number>) => string): string {
  const what = bookingWhat(b, lang);
  const place = what.kind === 'class' ? what.text : what.text ? t('A-0019', { court: what.text }) : '';
  return [dateOf(lang, b.startAt), timeOf(b.startAt), t(BOOKING_TYPE_KEY[b.type] ?? 'A-0306'), place].filter(Boolean).join(' · ');
}
const statusKey = (b: BookingRow) => BOOKING_STATUS_KEY[b.status] ?? 'A-new.prof_status_released';

function BookingList({ rows }: { rows: BookingRow[] }) {
  const { lang, t } = useAdmin();
  return (
    <ul className="adm-list" data-testid="prof-recent">
      {rows.map((b) => <li key={b.bookingId}><span>{bookingLine(b, lang, t)}</span><span className="adm-chip">{t(statusKey(b))}</span></li>)}
    </ul>
  );
}

function BookingTable({ rows }: { rows: BookingRow[] }) {
  const { lang, t } = useAdmin();
  return (
    <div className="adm-table-wrap">
      <table className="adm-table" data-testid="bookings-table">
        <thead><tr><th scope="col">{t('A-new.prof_col_when')}</th><th scope="col">{t('A-new.prof_col_what')}</th><th scope="col">{t('A-new.prof_col_status')}</th></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.bookingId}><td className="adm-nowrap">{dateOf(lang, b.startAt)} · {timeOf(b.startAt)}</td><td>{bookingLine(b, lang, t).split(' · ').slice(2).join(' · ')}{b.coachName ? ` · ${b.coachName}` : ''}</td><td>{t(statusKey(b))}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderTable({ rows }: { rows: OrderRow[] }) {
  const { lang, t } = useAdmin();
  return (
    <div className="adm-table-wrap">
      <table className="adm-table" data-testid="orders-table">
        <thead><tr><th scope="col">{t('A-new.prof_col_when')}</th><th scope="col">{t('A-new.prof_col_what')}</th><th scope="col">{t('A-new.prof_col_total')}</th><th scope="col">{t('A-new.prof_col_paid')}</th><th scope="col">{t('A-new.prof_col_receipts')}</th></tr></thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.orderId}>
              <td className="adm-nowrap">{dateOf(lang, o.createdAt)}</td>
              <td>{t(ORDER_KIND_KEY[o.kind] ?? 'A-new.prof_order_sale')}</td>
              <td className="adm-nowrap">{formatBaht(o.totalSatang)}</td>
              <td>{t('A-new.prof_paid_with', { money: formatBaht(o.moneySatang), credit: formatBaht(o.creditValueSatang), wallet: formatBaht(o.walletSatang) })}</td>
              <td>{o.receipts.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValuePanel({ value }: { value: Value | null }) {
  const { lang, t } = useAdmin();
  if (!value) return <p aria-busy="true" className="adm-muted">…</p>;
  const rows = (ledger: Value['wallet']['ledger'], money: boolean) => (ledger.length === 0 ? <p className="adm-muted">{t('A-new.prof_ledger_empty')}</p> : (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr><th scope="col">{t('A-new.prof_col_when')}</th><th scope="col">{t('A-new.prof_col_change')}</th><th scope="col">{t('A-new.prof_col_reason')}</th></tr></thead>
        <tbody>{ledger.map((r, i) => <tr key={i}><td className="adm-nowrap">{dateOf(lang, r.at)}</td><td className="adm-nowrap">{money ? (r.change > 0 ? '+' : '') + formatBaht(r.change) : (r.change > 0 ? '+' : '') + r.change}</td><td>{r.note ?? r.reason}</td></tr>)}</tbody>
      </table>
    </div>
  ));
  return (
    <>
      <section className="adm-card"><h2>{t('A-new.prof_wallet_balance')}</h2><p className="adm-tile-value" data-testid="wallet-balance">{formatBaht(value.wallet.balanceSatang)}</p>{rows(value.wallet.ledger, true)}</section>
      <section className="adm-card">
        <h2>{t('A-new.prof_packages')}</h2>
        {value.packages.length === 0 ? <p className="adm-muted">{t('A-new.prof_no_package')}</p> : (
          <ul className="adm-list" data-testid="packages">{value.packages.map((p) => (
            <li key={p.packageId}><span>{packageName(p, lang)} · {t('A-new.prof_credits_left', { left: p.creditsLeft, total: p.creditsTotal })}</span><span className="adm-muted">{t('A-0106', { dayMonthYear: longDayOf(lang, p.expiresAt) })}</span></li>
          ))}</ul>
        )}
        <h3>{t('A-new.prof_credit_ledger')}</h3>
        {rows(value.creditLedger, false)}
      </section>
    </>
  );
}

