import { describe, expect, it } from 'vitest';
import { settingByKey, validateSetting } from '../club/settings-registry';

// F06-T12: F06 reads two settings that already exist (F01 0041 and the registry); it adds none (PKG-03-AC1, AC10;
// D89, D116). Their unit is in the key: days before expiry, and months of wallet validity.
describe('the settings F06 reads', () => {
  it('package_expiry_reminder_days: a list of whole days, required, no default in code', () => {
    const def = settingByKey('package_expiry_reminder_days');
    expect(def).toMatchObject({ key: 'package_expiry_reminder_days', unsetAllowed: false, scope: 'rules' });
    expect(def?.key.endsWith('_days')).toBe(true);
    expect(validateSetting('package_expiry_reminder_days', [14, 3])).toEqual({ ok: true, value: [14, 3] });
    expect(validateSetting('package_expiry_reminder_days', [])).toMatchObject({ ok: false });
    expect(validateSetting('package_expiry_reminder_days', [3, 3])).toMatchObject({ ok: false });
    expect(validateSetting('package_expiry_reminder_days', [1.5])).toMatchObject({ ok: false });
    expect(validateSetting('package_expiry_reminder_days', 14)).toMatchObject({ ok: false });
  });
  it('wallet_expiry_months: whole months of at least 1, and unset allowed (unset means wallet value never expires, D89)', () => {
    const def = settingByKey('wallet_expiry_months');
    expect(def).toMatchObject({ key: 'wallet_expiry_months', unsetAllowed: true, scope: 'rules' });
    expect(def?.key.endsWith('_months')).toBe(true);
    expect(validateSetting('wallet_expiry_months', 6)).toEqual({ ok: true, value: 6 });
    expect(validateSetting('wallet_expiry_months', 0)).toMatchObject({ ok: false });
    expect(validateSetting('wallet_expiry_months', 2.5)).toMatchObject({ ok: false });
  });
  it('neither definition carries a value: values come from the template or the club', () => {
    for (const key of ['package_expiry_reminder_days', 'wallet_expiry_months']) {
      expect(Object.keys(settingByKey(key) ?? {}).sort()).toEqual(['key', 'scope', 'unsetAllowed', 'validate']);
    }
  });
});
