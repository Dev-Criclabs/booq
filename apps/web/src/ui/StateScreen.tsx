'use client';
import type { T } from '../client/i18n';

// Whole-screen states (S-Error-Offline): an icon, a title, a line of text and one action.
// The offline state uses P-0326, P-0327 and P-0328; "Nothing was booked or charged" is in the text.

export function OfflineIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 14 0M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" />
    </svg>
  );
}

export function StateScreen({ t, offline, titleKey, textKey, actionKey, onAction, testId, vars, secondKey, onSecond }: { t: T; offline?: boolean; titleKey?: string; textKey: string; actionKey?: string; onAction?(): void; testId: string; vars?: Record<string, string | number>; secondKey?: string; onSecond?(): void }) {
  return (
    <main className="app state" data-testid={testId}>
      <div className="state-body" role="alert">
        {offline ? (
          <span className="state-icon">
            <OfflineIcon />
          </span>
        ) : null}
        {titleKey ? <h1 className="state-title">{t(titleKey)}</h1> : null}
        <p className="state-text">{t(textKey, vars)}</p>
      </div>
      {actionKey && onAction ? (
        <div className="state-actions">
          <button type="button" className="btn btn-primary" onClick={onAction}>
            <span>{t(actionKey)}</span>
          </button>
          {secondKey && onSecond ? (
            <button type="button" className="btn btn-ghost" onClick={onSecond}>
              <span>{t(secondKey)}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export function Loading() {
  return (
    <main className="app loading" aria-busy="true">
      <span className="spinner" />
    </main>
  );
}
