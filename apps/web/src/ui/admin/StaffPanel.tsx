'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  ASSIGNABLE, cancelInvite, createInvite, deactivate, inviteBody, inviteLink, loadInvites, loadStaff, roleSet, ROLE_KEY, setRoles, shownRoles, staffErrorKey, type StaffInvite, type StaffMember,
} from '../../client/admin/staff';
import { longDayOf } from '../../client/admin/time';
import { useAdmin } from './AdminFrame';

// A17 Staff (F11-T23; ADMIN-17; board H-A17-Staff-audit): invite by a LINE link, who has a staff role and whether they are active, change roles,
// deactivate. The invite link is shown once; the token is never read back. The owner's role is fixed. English and Thai from the language files.

type Load = { kind: 'loading' } | { kind: 'ready'; staff: StaffMember[]; invites: StaffInvite[] } | { kind: 'error' } | { kind: 'forbidden' };
type Msg = { key: string; error: boolean } | null;

export function StaffPanel({ onForbidden }: { onForbidden?(): void }) {
  const { slug, lang, t } = useAdmin();
  const f = () => window.fetch.bind(window);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [choice, setChoice] = useState<'front_desk' | 'accountant' | 'both' | 'coach'>('front_desk');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [roles, setEditRoles] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [s, i] = await Promise.all([loadStaff(slug, f()), loadInvites(slug, f())]);
    if (s.kind === 'forbidden' || i.kind === 'forbidden') return setLoad({ kind: 'forbidden' });
    if (s.kind !== 'ok' || i.kind !== 'ok') return setLoad({ kind: 'error' });
    setLoad({ kind: 'ready', staff: s.body, invites: i.body });
  }, [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);
  // "Add coach" on Coaches comes here with the Coach role chosen (a person becomes a coach through an invite).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('role') === 'coach') setChoice('coach');
  }, []);

  async function cancel(id: string) {
    if (!window.confirm(t('A-new.staff_invite_cancel_confirm'))) return;
    setBusy(true);
    const r = await cancelInvite(slug, id, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: staffErrorKey(r), error: true });
    setMsg({ key: 'A-new.staff_invite_cancelled', error: false });
    await reload();
  }
  async function invite() {
    const body = inviteBody(choice === 'coach' ? 'coach' : choice === 'both' ? ['front_desk', 'accountant'] : [choice]);
    if (!body) return setMsg({ key: 'A-new.staff_invite_pick', error: true });
    setBusy(true);
    const r = await createInvite(slug, body, f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: staffErrorKey(r), error: true });
    setMsg(null);
    setLink(inviteLink(window.location.origin, slug, r.body.token));
    setCopied(false);
    await reload();
  }
  async function saveRoles(id: string) {
    setBusy(true);
    const r = await setRoles(slug, id, roleSet(roles), f());
    setBusy(false);
    if (r.kind !== 'ok') return setMsg({ key: staffErrorKey(r), error: true });
    setEditing(null);
    setMsg({ key: 'A-new.staff_saved', error: false });
    await reload();
  }
  async function confirmDeactivate(id: string) {
    setBusy(true);
    const r = await deactivate(slug, id, f());
    setBusy(false);
    setConfirming(null);
    if (r.kind !== 'ok') return setMsg({ key: staffErrorKey(r), error: true });
    setMsg({ key: 'A-new.staff_saved', error: false });
    await reload();
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* the link stays selected in its box; the person copies it by hand */
    }
  }

  if (load.kind === 'loading') return <p aria-busy="true" className="adm-muted">…</p>;
  if (load.kind === 'forbidden') {
    onForbidden?.();
    return <p role="alert" data-testid="staff-forbidden">{t('A-new.staff_forbidden')}</p>;
  }
  if (load.kind === 'error') return <div role="alert" data-testid="staff-error"><p>{t('A-new.staff_load_failed')}</p><button type="button" className="adm-btn" onClick={() => { setLoad({ kind: 'loading' }); void reload(); }}>{t('A-new.cust_retry')}</button></div>;

  const roleName = (r: string) => t(ROLE_KEY[r] ?? 'A-new.staff_role_player');
  return (
    <section data-testid="staff" aria-labelledby="staff-title">
      <h2 id="staff-title" className="adm-h2">{t('A-new.staff_title')}</h2>
      {msg ? <p role={msg.error ? 'alert' : 'status'} className={msg.error ? 'adm-error' : 'adm-ok'} data-testid="staff-msg">{t(msg.key)}</p> : null}

      <div className="adm-card" data-testid="invite-card">
        <h3>{t('A-new.staff_invite_title')}</h3>
        <label className="adm-field adm-grow">
          <span>{t('A-new.staff_invite_role')}</span>
          <select value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)} data-testid="invite-role">
            <option value="front_desk">{roleName('front_desk')}</option>
            <option value="accountant">{roleName('accountant')}</option>
            <option value="both">{roleName('front_desk')} + {roleName('accountant')}</option>
            <option value="coach">{roleName('coach')}</option>
          </select>
        </label>
        <button type="button" className="adm-btn" disabled={busy} onClick={() => void invite()} data-testid="invite-make">{t('A-0370')}</button>
        {link ? (
          <div className="adm-linkbox" role="dialog" aria-label={t('A-new.staff_link_title')} data-testid="invite-link-box">
            <p>{t('A-new.staff_link_once')}</p>
            <input readOnly value={link} aria-label={t('A-new.staff_link_title')} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
            <div className="adm-row">
              <button type="button" className="adm-btn" onClick={() => void copy()} data-testid="invite-copy">{copied ? t('A-new.staff_link_copied') : t('A-0370')}</button>
              <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setLink(null); setCopied(false); }} data-testid="invite-done">{t('A-new.staff_link_done')}</button>
            </div>
          </div>
        ) : null}
      </div>

      {load.staff.length === 0 ? <p className="adm-muted" data-testid="staff-empty">{t('A-new.staff_empty')}</p> : (
        <div className="adm-table-wrap">
          <table className="adm-table" data-testid="staff-table">
            <thead><tr><th scope="col">{t('A-0075')}</th><th scope="col">{t('A-0372')}</th><th scope="col">{t('A-0373')}</th><th scope="col"><span className="adm-sr">{t('A-new.staff_edit_roles')}</span></th></tr></thead>
            <tbody>
              {load.staff.map((m) => {
                const isOwner = m.roles.includes('owner');
                return (
                  <tr key={m.id} data-testid={`staff-${m.id}`}>
                    <th scope="row">{m.display_name ?? t('A-new.cust_no_name')}</th>
                    <td><span className="adm-chips">{shownRoles(m.roles).map((r) => <span key={r} className="adm-chip">{roleName(r)}</span>)}</span></td>
                    <td>{t(m.active ? 'A-0375' : 'A-new.staff_inactive')}</td>
                    <td>
                      {isOwner || !m.active ? (isOwner ? <span className="adm-muted">{t('A-new.staff_owner_fixed')}</span> : null) : editing === m.id ? (
                        <div className="adm-roles" data-testid={`roles-${m.id}`}>
                          {ASSIGNABLE.map((r) => (
                            <label key={r} className="adm-check"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => setEditRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} data-testid={`role-${r}`} /> {roleName(r)}</label>
                          ))}
                          <div className="adm-row">
                            <button type="button" className="adm-btn" disabled={busy} onClick={() => void saveRoles(m.id)} data-testid="roles-save">{t('A-new.staff_save_roles')}</button>
                            <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setEditing(null)}>{t('A-new.staff_cancel')}</button>
                          </div>
                        </div>
                      ) : confirming === m.id ? (
                        <div className="adm-roles" role="alertdialog" data-testid={`confirm-${m.id}`}>
                          <p>{t('A-new.staff_confirm_deactivate', { name: m.display_name ?? '' })}</p>
                          <div className="adm-row">
                            <button type="button" className="adm-btn" disabled={busy} onClick={() => void confirmDeactivate(m.id)} data-testid="deactivate-yes">{t('A-new.staff_confirm_yes')}</button>
                            <button type="button" className="adm-btn adm-btn-ghost" onClick={() => setConfirming(null)}>{t('A-new.staff_cancel')}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="adm-row">
                          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setEditing(m.id); setEditRoles(m.roles.filter((r) => (ASSIGNABLE as readonly string[]).includes(r))); setConfirming(null); }} data-testid={`edit-${m.id}`}>{t('A-new.staff_edit_roles')}</button>
                          <button type="button" className="adm-btn adm-btn-ghost" onClick={() => { setConfirming(m.id); setEditing(null); }} data-testid={`deactivate-${m.id}`}>{t('A-0376')}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="adm-card" data-testid="invites">
        <h3>{t('A-new.staff_invites_title')}</h3>
        {load.invites.length === 0 ? <p className="adm-muted">{t('A-new.staff_invites_none')}</p> : (
          <ul className="adm-list">{load.invites.map((i) => (
            <li key={i.id}><span>{shownRoles(i.roles).map((r) => roleName(r)).join(' + ')} · {t('A-0379')}</span><span className="adm-muted">{t('A-new.staff_invite_expires', { dayMonthYear: longDayOf(lang, i.expires_at) })}</span><button type="button" className="adm-btn adm-btn-ghost" disabled={busy} onClick={() => void cancel(i.id)} data-testid={`invite-cancel-${i.id}`}>{t('A-new.staff_invite_cancel')}</button></li>
          ))}</ul>
        )}
      </div>
    </section>
  );
}
