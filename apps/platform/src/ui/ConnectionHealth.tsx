'use client';
import { useEffect, useRef, useState } from 'react';
import type { Failure, SupportSetup } from './club';
import { CHECK_KEY, GIVE_UP_MS, POLL_MS, reasonKey, requestRecheck } from './health';
import { t } from './i18n';

// The last result of each connection check and "Test all again" (D167). The worker does the check with the stored secrets; this page
// asks and then watches the setup until the request is answered. A look only (Live) club can be asked too. English only; text by key.

export function ConnectionHealth({ id, support, reload, onNotice }: { id: string; support: SupportSetup; reload(): Promise<void>; onNotice(n: { key: string; error: boolean }): void }) {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const since = useRef<number | null>(null);
  const waiting = Boolean(support.checkRequestedAt);

  useEffect(() => {
    if (!waiting) {
      since.current = null;
      setSlow(false);
      return;
    }
    since.current ??= Date.now();
    const timer = setInterval(() => {
      if (Date.now() - (since.current ?? Date.now()) > GIVE_UP_MS) return setSlow(true);
      void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  async function ask() {
    setBusy(true);
    const r = await requestRecheck(window.fetch.bind(window), id);
    setBusy(false);
    if (r.kind === 'error') return onNotice({ key: (r as Failure).key, error: true });
    since.current = Date.now();
    setSlow(false);
    await reload();
  }

  const rows = support.health ?? [];
  return (
    <div data-testid="health">
      {rows.length === 0 ? <p className="sub" data-testid="health-none">{t('X-new.health_none')}</p> : (
        <ul>
          {rows.map((h) => (
            <li key={h.check_key} data-testid={`health-${h.check_key}`}>
              {t(CHECK_KEY[h.check_key] ?? 'X-new.health_other', { check: h.check_key })} · <strong>{t(h.status === 'ok' ? 'X-new.health_status_ok' : 'X-new.health_status_failed')}</strong>
              {h.status === 'failed' ? ` · ${t(reasonKey(h.reason), { code: h.reason ?? '' })}` : ''}
            </li>
          ))}
        </ul>
      )}
      {waiting ? <p role="status" data-testid="health-waiting">{t(slow ? 'X-new.health_slow' : 'X-new.health_waiting')}</p> : null}
      <button type="button" className="btn secondary" disabled={busy || waiting} onClick={() => void ask()} data-testid="recheck">{t('X-new.health_recheck')}</button>
    </div>
  );
}
