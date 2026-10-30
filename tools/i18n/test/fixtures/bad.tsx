// Fixture for lint-hardcoded-text. Every line marked BAD must be reported.
import { t } from '@/i18n'

export function Screen({ amount }: { amount: string }) {
  toast('Booking saved') // BAD ui-call
  if (!amount) throw new Error('Court is taken') // BAD error-message
  const card = { type: 'text', text: 'Your slot is released' } // BAD user-prop
  const th = 'ยกเลิกการจอง' // BAD thai-text
  const same = 'Sign in to book' // BAD locale-copy (P-0001)
  t('P-9999') // BAD unknown-key
  t('P-0100') // BAD missing-vars (needs holdMinutes)
  return (
    <div>
      <button title="Close the dialog">{t('P-0004')}</button> {/* BAD jsx-attr */}
      <p>Book a court</p> {/* BAD jsx-text */}
    </div>
  )
}
