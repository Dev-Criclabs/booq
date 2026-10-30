import { t } from '@/i18n'

export function Screen({ minutes }: { minutes: number }) {
  console.log('screen rendered') // i18n-ignore log line, not shown to anyone
  return (
    <div className="flex items-center gap-2" data-testid="screen">
      <button title={t('P-0004')} aria-label={t('P-0005')}>{t('P-0004')}</button>
      <p>{t('P-0100', { holdMinutes: minutes })}</p>
      <input type="text" placeholder={t('P-0012')} />
    </div>
  )
}
