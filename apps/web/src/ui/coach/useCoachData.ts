'use client';
import { useCallback, useEffect, useState } from 'react';
import type { CoachResult } from '../../client/coach/api';

// One read of the coach portal with its states: loading, ready, offline (the call never reached the server) and not a coach (the server
// answered 403, F12 design 7). Any other refusal is an error with its code. `reload` reads again behind the current screen.
export type CoachLoad<T> = { state: 'loading' } | { state: 'ready'; body: T } | { state: 'offline' } | { state: 'not_coach' } | { state: 'error'; code: string };

export function useCoachData<T>(read: () => Promise<CoachResult<T>>, deps: readonly unknown[]) {
  const [load, setLoad] = useState<CoachLoad<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    void read().then((r) => {
      if (!live) return;
      if (r.ok) setLoad({ state: 'ready', body: r.body });
      else if (r.code === 'offline') setLoad({ state: 'offline' });
      else if (r.status === 403) setLoad({ state: 'not_coach' });
      else setLoad({ state: 'error', code: r.code });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { load, reload };
}
