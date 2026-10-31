'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ConnectionEditor } from './ConnectionEditor';
import { ConsoleNav } from './ConsoleNav';
import { loadClub, type ClubView, type Failure } from './club';
import { t } from './i18n';
import { StepUpPanel } from './StepUpPanel';
import { SupportEditor } from './SupportEditor';
import {
  basicsFrom, checkBasics, checkPlan, clockTime, createClub, dayOf, emptyBasics, FIELD_KEY, OPTION_KEY, PAYMENT_OPTIONS, saveBasics, savePaymentOption, savePlan, slugify,
  STEP_HEADER_KEY, STEP_TITLE_KEY, STEPS, stepNumber, type BasicField, type BasicValues, type PaymentOption, type Problem, type Step,
} from './wizard';

// /clubs/new and /clubs/{id}/setup?step=n (P2): the five steps of setting up a new club. Step 1 creates the club as a Draft; each
// later step saves into the draft. The plan text is display copy from the language files; nothing about price is stored.
// LINE and Beam values are tested as they are typed and saved only if the check passes, unless the staff member saves anyway (D167).
// Slip checking details have no API yet. English only; text by key.

type Load = { kind: 'loading' } | { kind: 'error'; key: string; signIn?: boolean } | { kind: 'ready'; club: ClubView };
type Go = Step | 'stay' | 'finish';

export function WizardScreen({ id, step }: { id?: string; step: Step }) {
  const [load, setLoad] = useState<Load>(id ? { kind: 'loading' } : { kind: 'ready', club: null as never });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ run(): Promise<void> } | null>(null);
  const [notice, setNotice] = useState<{ key: string; error: boolean } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [values, setValues] = useState<BasicValues>(emptyBasics());
  const [slugEdited, setSlugEdited] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [planProblem, setPlanProblem] = useState<string | null>(null);
  const [plan, setPlan] = useState({ trial: '', billing: '' });
  const [option, setOption] = useState<PaymentOption | ''>('');

  const reload = useCallback(async () => {
    if (!id) return;
    const r = await loadClub(window.fetch.bind(window), id);
    if (r.kind !== 'ok') return setLoad({ kind: 'error', key: r.key, ...(r.signIn ? { signIn: true } : {}) });
    const c = r.club.support.club;
    setLoad({ kind: 'ready', club: r.club });
    setValues(basicsFrom(c));
    setSlugEdited(true);
    setPlan({ trial: dayOf(c['plan_trial_ends_at']), billing: dayOf(c['billing_starts_at']) });
    setOption(c['payment_option'] === 'beam' || c['payment_option'] === 'slip' ? c['payment_option'] : '');
  }, [id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const club = load.kind === 'ready' ? load.club : null;
  const was = club ? basicsFrom(club.support.club) : emptyBasics();
  const wasPlan = club ? { trial: dayOf(club.support.club['plan_trial_ends_at']), billing: dayOf(club.support.club['billing_starts_at']) } : { trial: '', billing: '' };
  const locked = !!club && club.support.mode !== 'edit';
  const here = (n: number) => (id ? `/clubs/${encodeURIComponent(id)}/setup?step=${n}` : '/clubs/new');
  const signIn = `/sign-in?next=${encodeURIComponent(id ? here(stepNumber(step)) : '/clubs/new')}`;

  /** Runs a save; a stale second factor opens the step-up and the same save runs again once it passes (D161). */
  async function perform<T extends { kind: string }>(run: () => Promise<T | Failure>, onOk: (r: T) => void) {
    const attempt = async (): Promise<void> => {
      setBusy(true);
      const r = await run();
      setBusy(false);
      if (r.kind === 'error') {
        const f = r as Failure;
        if (f.stepUp) return setPending({ run: attempt });
        setPending(null);
        return setNotice({ key: f.key, error: true });
      }
      setPending(null);
      setNotice(null);
      setSaved(clockTime(new Date()));
      onOk(r as T);
    };
    await attempt();
  }
  const leave = (to: Go, clubId: string) => {
    if (to === 'stay') return void reload();
    window.location.assign(to === 'finish' ? `/clubs/${encodeURIComponent(clubId)}` : `/clubs/${encodeURIComponent(clubId)}/setup?step=${stepNumber(to)}`);
  };

  function submitBasics(to: Go) {
    const p = checkBasics(values, !id);
    setProblem(p);
    if (p) return;
    setPlanProblem(null);
    if (!id) return void perform(() => createClub(window.fetch.bind(window), values), (r) => leave(to === 'stay' ? 'basics' : to, (r as { id: string }).id));
    void perform(() => saveBasics(window.fetch.bind(window), id, values, was), () => leave(to, id));
  }
  function submitPlan(to: Go) {
    const p = checkPlan(plan.trial, plan.billing);
    setPlanProblem(p);
    if (p || !id) return;
    void perform(() => savePlan(window.fetch.bind(window), id, plan, wasPlan), () => leave(to, id));
  }
  function submitPayments(to: Go) {
    if (!id) return;
    if (option === '' || option === was_option(club)) return leave(to, id);
    void perform(() => savePaymentOption(window.fetch.bind(window), id, option), () => leave(to, id));
  }
  const submit = (to: Go) => (step === 'basics' ? submitBasics(to) : step === 'plan' ? submitPlan(to) : step === 'payments' ? submitPayments(to) : leave(to, id ?? ''));
  const onForm = (e: FormEvent) => {
    e.preventDefault();
    submit(step === 'payments' ? 'finish' : STEPS[stepNumber(step)]!);
  };

  const name = values.name_en || club?.support.club['name_en'] || '';
  const field = (k: BasicField, extra?: { placeholder?: string; type?: string }) => (
    <div className="field" key={k}>
      <label htmlFor={`w-${k}`}>{t(FIELD_KEY[k])}</label>
      <input id={`w-${k}`} data-testid={`w-${k}`} value={values[k]} disabled={locked || (k === 'slug' && !!id)} {...extra}
        onChange={(e) => {
          const v = e.target.value;
          setValues((prev) => ({ ...prev, [k]: v, ...(k === 'name_en' && !slugEdited && !id ? { slug: slugify(v) } : {}) }));
          if (k === 'slug') setSlugEdited(true);
        }} />
      {problem?.field === k ? <p role="alert" className="error" data-testid={`w-problem-${k}`}>{t(problem.key)}</p> : null}
    </div>
  );

  return (
    <>
      <ConsoleNav current="clubs" />
      <main className="page wide" data-testid="wizard">
        <p><a href={id ? `/clubs/${encodeURIComponent(id)}` : '/clubs'} data-testid="back">{t('X-new.club_back')}</a></p>
        <h1>{name ? t('X-new.wizard_title', { name }) : t('X-new.wizard_title_new')}</h1>
        <ol className="steps" aria-label={t('X-new.wizard_steps')} data-testid="steps">
          {STEPS.map((s) => (
            <li key={s} aria-current={s === step ? 'step' : undefined} className={s === step ? 'on' : undefined}>
              {id || s === 'basics' ? <a href={here(stepNumber(s))} data-testid={`step-${s}`}>{t(STEP_TITLE_KEY[s])}</a> : <span data-testid={`step-${s}`}>{t(STEP_TITLE_KEY[s])}</span>}
            </li>
          ))}
        </ol>
        <p className="lede" data-testid="step-header">{saved || id ? t(STEP_HEADER_KEY[step], { time: saved ?? '—' }) : t('X-new.wizard_unsaved', { step: stepNumber(step), name: t(STEP_TITLE_KEY[step]) })}</p>

        {load.kind === 'loading' ? <p aria-busy="true">…</p> : null}
        {load.kind === 'error' ? (
          <p role="alert" data-testid="load-error">{t(load.key)} {load.signIn ? <a href={signIn} data-testid="sign-in-link">{t('X-new.signin_link')}</a> : null}</p>
        ) : null}
        {pending ? <StepUpPanel signInHref={signIn} onCancel={() => setPending(null)} onDone={() => { const again = pending.run; setPending(null); void again(); }} /> : null}
        {notice ? <p role={notice.error ? 'alert' : 'status'} className={notice.error ? 'error' : 'ok'} data-testid="notice">{t(notice.key)}</p> : null}
        {locked ? <p className="notice" data-testid="wizard-locked">{t('X-new.club_look_only')}</p> : null}

        {load.kind === 'ready' && (!id || club) ? (
          <>
            {step === 'basics' ? (
              <form onSubmit={onForm} className="form card" data-testid="step-basics-form" noValidate>
                <h2>{t('X-0035')}</h2>
                {(['name_th', 'name_en', 'slug', 'legal_name'] as const).map((k) => field(k))}
                {field('tax_id', { placeholder: t('X-0045') })}
                {field('tax_branch', { placeholder: t('X-0047') })}
                {field('registered_address')}
                {(['owner_name', 'owner_phone', 'owner_line', 'owner_email'] as const).map((k) => field(k))}
                <p className="sub">{t('X-0056')}</p>
                <div className="field">
                  <label htmlFor="w-default_language">{t(FIELD_KEY.default_language)}</label>
                  <select id="w-default_language" data-testid="w-default_language" value={values.default_language} disabled={locked} onChange={(e) => setValues({ ...values, default_language: e.target.value })}>
                    <option value="en">{t('X-new.legal_lang_en')}</option>
                    <option value="th">{t('X-new.legal_lang_th')}</option>
                  </select>
                </div>
                <Buttons />
              </form>
            ) : null}

            {step === 'plan' ? (
              <form onSubmit={onForm} className="form card" data-testid="step-plan-form" noValidate>
                <h2>{t('X-0063')}</h2>
                <p><strong>{t('X-0064')}</strong></p>
                <p className="sub">{t('X-0065')}</p>
                <p className="sub">{t('X-0066')}</p>
                <div className="field"><label htmlFor="w-trial">{t('X-0067')}</label><input id="w-trial" data-testid="w-trial" placeholder="YYYY-MM-DD" inputMode="numeric" value={plan.trial} disabled={locked} onChange={(e) => setPlan({ ...plan, trial: e.target.value })} /></div>
                <div className="field"><label htmlFor="w-billing">{t('X-0069')}</label><input id="w-billing" data-testid="w-billing" placeholder="YYYY-MM-DD" inputMode="numeric" value={plan.billing} disabled={locked} onChange={(e) => setPlan({ ...plan, billing: e.target.value })} /></div>
                <p className="sub">{t('X-0070')}</p>
                {planProblem ? <p role="alert" className="error" data-testid="w-problem-plan">{t(planProblem)}</p> : null}
                <Buttons />
              </form>
            ) : null}

            {step === 'courts' && club ? (
              <section className="card" data-testid="step-courts-form">
                <h2>{t('X-0037')}</h2>
                <p className="sub">{t('X-0095')}</p>
                <SupportEditor id={id!} support={club.support} busy={busy || locked} only="courts" onSaved={async () => { setSaved(clockTime(new Date())); setNotice({ key: 'X-new.support_saved', error: false }); await reload(); }} onError={(key) => setNotice({ key, error: true })} />
                <Buttons plain />
              </section>
            ) : null}

            {step === 'line' ? (
              <section className="card" data-testid="step-line-form">
                <h2>{t('X-0140')}</h2>
                <p className="sub">{t('X-0097')}</p>
                <ConnectionEditor id={id!} kind="line" canEdit={!locked} askStepUp={(run) => setPending({ run })} onNotice={setNotice} onSaved={() => { setSaved(clockTime(new Date())); }} />
                <Buttons plain />
              </section>
            ) : null}

            {step === 'payments' ? (
              <form onSubmit={onForm} className="form card" data-testid="step-payments-form" noValidate>
                <h2>{t('X-0118')}</h2>
                <p className="sub">{t('X-0117')}</p>
                {PAYMENT_OPTIONS.map((o) => (
                  <label key={o} className="check">
                    <input type="radio" name="payment_option" value={o} checked={option === o} disabled={locked} onChange={() => setOption(o)} data-testid={`option-${o}`} />
                    {' '}<strong>{t(OPTION_KEY[o].title)}</strong> <span className="sub">{t(OPTION_KEY[o].text)}</span>
                  </label>
                ))}
                <Buttons last />
              </form>
            ) : null}
            {step === 'payments' ? (
              <section className="card" data-testid="step-payments-keys">
                <ConnectionEditor id={id!} kind="payments" canEdit={!locked} option={option} askStepUp={(run) => setPending({ run })} onNotice={setNotice} onSaved={() => { setSaved(clockTime(new Date())); void reload(); }} />
              </section>
            ) : null}
          </>
        ) : null}
        <p className="sub">{t('X-0039')}</p>
      </main>
    </>
  );

  function Buttons({ last, plain }: { last?: boolean; plain?: boolean }) {
    const n = stepNumber(step);
    const go = (to: Go) => (plain ? leave(to, id ?? '') : submit(to));
    return (
      <div className="row" data-testid="wizard-buttons">
        {n > 1 && id ? <a className="btn secondary" href={here(n - 1)} data-testid="back-step">{t('X-0071')}</a> : null}
        {locked ? null : <button type="button" className="btn secondary" disabled={busy || (!id && step !== 'basics')} onClick={() => go('stay')} data-testid="save-draft">{t('X-0034')}</button>}
        {last ? (
          <button type="submit" className="btn" disabled={busy} data-testid="finish">{t('X-0131')}</button>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => go(STEPS[n]!)} data-testid="next">{t('X-0061')}</button>
        )}
      </div>
    );
  }
}

const was_option = (club: ClubView | null): string => (club?.support.club['payment_option'] as string | null | undefined) ?? '';
