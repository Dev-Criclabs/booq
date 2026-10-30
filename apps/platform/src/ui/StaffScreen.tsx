'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { t } from './i18n';
import { deactivate, invite, loadTeam, resetFactor, ROLE_KEY, type LinkOutcome, type Member } from './staff';

// /staff (P6, team part): the platform team, invite a teammate, reset a teammate's second factor, deactivate. After an invite or
// a reset the enrolment link is shown once, in a box the admin copies from; closing the box forgets it. The link is never
// stored by the page. Admin only (the routes refuse anyone else). Text is by key (English only).

const ROLES: Member['role'][] = ['onboarding_specialist', 'platform_admin'];

export function StaffScreen() {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; key: string } | { kind: 'ready'; team: Member[] }>({ kind: 'loading' });
  const [form, setForm] = useState<{ email: string; displayName: string; role: Member['role'] }>({ email: '', displayName: '', role: 'onboarding_specialist' });
  const [shown, setShown] = useState<{ name: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await loadTeam(window.fetch.bind(window));
    setState(r.kind === 'ok' ? { kind: 'ready', team: r.team } : { kind: 'error', key: r.key });
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function after(r: LinkOutcome, name: string) {
    setBusy(false);
    if (r.kind === 'error') return setMessage(r.key);
    setMessage(null);
    if (r.kind === 'link') setShown({ name, link: r.link });
    await reload();
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const name = form.displayName.trim();
    const r = await invite(window.fetch.bind(window), { email: form.email.trim(), displayName: name, role: form.role });
    if (r.kind !== 'error') setForm({ email: '', displayName: '', role: 'onboarding_specialist' });
    await after(r, name);
  }

  async function onReset(m: Member) {
    if (busy || !window.confirm(t('X-new.staff_confirm_reset', { name: m.displayName }))) return;
    setBusy(true);
    await after(await resetFactor(window.fetch.bind(window), m.id), m.displayName);
  }

  async function onDeactivate(m: Member) {
    if (busy || !window.confirm(t('X-new.staff_confirm_deactivate', { name: m.displayName }))) return;
    setBusy(true);
    await after(await deactivate(window.fetch.bind(window), m.id), m.displayName);
  }

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.link);
      setCopied(true);
    } catch {
      setCopied(false); // the box stays selectable, so it can be copied by hand
    }
  }

  return (
    <main className="page wide" data-testid="staff">
      <h1>{t('X-new.staff_title')}</h1>
      {message ? <p role="alert" className="error" data-testid="message">{t(message)}</p> : null}

      {shown ? (
        <section className="link-box" role="dialog" aria-modal="false" aria-labelledby="link-title" data-testid="link-box">
          <h2 id="link-title">{t('X-new.staff_link_title')}</h2>
          <p>{t('X-new.staff_link_once', { name: shown.name })}</p>
          <input readOnly value={shown.link} aria-label={t('X-new.staff_link_title')} data-testid="link" onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <button type="button" className="btn" onClick={copy} data-testid="copy">{copied ? t('X-new.staff_link_copied') : t('X-0152')}</button>
            <button type="button" className="btn secondary" onClick={() => { setShown(null); setCopied(false); }} data-testid="link-done">{t('X-new.staff_link_done')}</button>
          </div>
        </section>
      ) : null}

      {state.kind === 'loading' ? <p aria-busy="true">…</p> : null}
      {state.kind === 'error' ? <p role="alert" data-testid="load-error">{t(state.key)}</p> : null}
      {state.kind === 'ready' ? (
        <>
          <form onSubmit={onInvite} className="form inline" data-testid="invite-form">
            <h2>{t('X-0260')}</h2>
            <label htmlFor="displayName">{t('X-0261')}</label>
            <input id="displayName" name="displayName" required placeholder={t('X-0266')} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <label htmlFor="email">{t('X-new.staff_email')}</label>
            <input id="email" name="email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label htmlFor="role">{t('X-0262')}</label>
            <select id="role" name="role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Member['role'] })}>
              {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_KEY[r])}</option>)}
            </select>
            <button type="submit" className="btn" disabled={busy || form.displayName.trim() === '' || form.email.trim() === ''} data-testid="invite">{t('X-new.staff_invite_submit')}</button>
          </form>
          <table className="team" data-testid="team">
            <thead>
              <tr>
                <th scope="col">{t('X-0261')}</th>
                <th scope="col">{t('X-new.staff_email')}</th>
                <th scope="col">{t('X-0262')}</th>
                <th scope="col">{t('X-new.staff_status')}</th>
                <th scope="col"><span className="sr-only">{t('X-new.staff_reset')}</span></th>
              </tr>
            </thead>
            <tbody>
              {state.team.map((m) => (
                <tr key={m.id} data-testid={`member-${m.id}`}>
                  <th scope="row">{m.displayName}</th>
                  <td>{m.email}</td>
                  <td>{t(ROLE_KEY[m.role])}</td>
                  <td>{m.active ? t('X-new.staff_status_active') : t('X-new.staff_status_inactive')}</td>
                  <td className="actions">
                    {m.active ? (
                      <>
                        <button type="button" className="btn small" disabled={busy} onClick={() => void onReset(m)} data-testid={`reset-${m.id}`}>{t('X-new.staff_reset')}</button>
                        <button type="button" className="btn small secondary" disabled={busy} onClick={() => void onDeactivate(m)} data-testid={`deactivate-${m.id}`}>{t('X-new.staff_deactivate')}</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
