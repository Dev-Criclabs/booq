'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildState, DEFAULT_KEY, draftOf, labelsBody, loadRichMenu, menuErrorKey, saveLabels, shouldPoll, STATE_KEY, TILES, type Draft, type RichMenu } from '../../client/admin/richmenu';
import { dateOf, timeOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A16 LINE menu labels (LINE-02, D114): the owner's Thai and English words for the six tiles. Saving asks for a rebuild; this card reads the result every few seconds while it runs.
// The links are fixed and cannot be changed here. An empty label shows the default words.

export function RichMenuCard() {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [menu, setMenu] = useState<RichMenu | null>(null);
  const [was, setWas] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ key: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const polls = useRef(0);

  const read = useCallback(async (keepDraft: boolean) => {
    const r = await loadRichMenu(slug, window.fetch.bind(window));
    if (r.kind !== 'ok') return setGone(true);
    setMenu(r.body);
    if (!keepDraft) {
      const d = draftOf(r.body.tiles);
      setWas(d);
      setDraft(d);
    }
  }, [slug]);
  useEffect(() => {
    void read(false);
  }, [read]);
  // While a build is waiting or running the result is read again, up to about two minutes.
  useEffect(() => {
    if (!menu || !shouldPoll(menu) || polls.current >= 40) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void read(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [menu, read]);

  if (gone) return null;
  if (!menu || !draft || !was) return <p aria-busy="true" className="adm-muted">…</p>;
  const state = buildState(menu);

  async function save() {
    const b = labelsBody(was!, draft!);
    if (!b.ok) return setMsg({ key: b.key, error: true });
    setBusy(true);
    const r = await saveLabels(slug, b.labels, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: menuErrorKey(r), error: true });
    polls.current = 0;
    setMsg({ key: 'A-new.set_menu_queued', error: false });
    await read(false);
  }
  const set = (n: number, side: 'th' | 'en', v: string) => setDraft({ ...draft!, [n]: { ...draft![n]!, [side]: v } });
  return (
    <section className="adm-card" aria-labelledby="set-menu" data-testid="set-menu">
      <h2 id="set-menu">{t('A-new.set_menu_title')}</h2>
      <p className="adm-muted">{t('A-new.set_menu_hint')}</p>
      <p data-testid="menu-state" role="status"><span className="adm-chip">{t(STATE_KEY[state])}</span>
        {state === 'active' && menu.build?.uploadedAt ? <span className="adm-muted"> {t('A-new.set_menu_uploaded', { date: dateOf(lang, menu.build.uploadedAt), time: timeOf(menu.build.uploadedAt) })}</span> : null}
        {state === 'failed' && menu.build?.error ? <span className="adm-muted"> {t('A-new.set_menu_code', { code: menu.build.error })}</span> : null}
      </p>
      {TILES.map((n) => (
        <div key={n} className="adm-rule" data-testid={`tile-${n}`}>
          <p className="adm-rule-label">{t('A-new.set_menu_tile', { n })} · {t('A-new.set_menu_default', { label: t(DEFAULT_KEY[n]!) })}</p>
          <div className="adm-form">
            <label className="adm-field"><span>{t('A-new.set_menu_th')}</span><input value={draft[n]!.th} maxLength={60} disabled={busy} placeholder={t(DEFAULT_KEY[n]!)} onChange={(e) => set(n, 'th', e.target.value)} data-testid={`tile-${n}-th`} /></label>
            <label className="adm-field"><span>{t('A-new.set_menu_en')}</span><input value={draft[n]!.en} maxLength={60} disabled={busy} placeholder={t(DEFAULT_KEY[n]!)} onChange={(e) => set(n, 'en', e.target.value)} data-testid={`tile-${n}-en`} /></label>
          </div>
        </div>
      ))}
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="menu-msg">{t(msg.key)}</p> : null}
      <button type="button" className="adm-btn" disabled={busy} onClick={() => void save()} data-testid="menu-save">{t('A-new.set_menu_save')}</button>
    </section>
  );
}
