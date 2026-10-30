'use client';
import { useState } from 'react';
import { safeNext } from './auth';
import { t } from './i18n';
import { StepUpPanel } from './StepUpPanel';

// /step-up?next=/staff: the step-up on its own page, for a link or a page that sends the person here and back.
export function StepUpScreen({ next }: { next: string | null }) {
  const [done, setDone] = useState(false);
  const target = safeNext(next);
  return (
    <main className="page" data-testid="step-up-page">
      <h1>{t('X-new.stepup_title')}</h1>
      {done ? (
        <p role="status" data-testid="step-up-done">
          <a href={target}>{t('X-new.staff_link_done')}</a>
        </p>
      ) : (
        <StepUpPanel onDone={() => (window.location.replace(target), setDone(true))} signInHref={`/sign-in?next=${encodeURIComponent('/step-up?next=' + target)}`} />
      )}
    </main>
  );
}
