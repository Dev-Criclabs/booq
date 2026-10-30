import { describe, expect, it } from 'vitest';
import { parseThbToSatang } from './csv';

// PLAT-06-AC9: amounts in an import file are baht and become integer satang. F06 reads package and balance amounts with this.
describe('parseThbToSatang', () => {
  it('reads baht, with or without satang, a baht sign and thousands commas', () => {
    expect(parseThbToSatang('500')).toBe(50000);
    expect(parseThbToSatang('4,500')).toBe(450000);
    expect(parseThbToSatang('฿ 8,000.50')).toBe(800050);
    expect(parseThbToSatang('12.5')).toBe(1250);
    expect(parseThbToSatang('0.05')).toBe(5);
    expect(parseThbToSatang(' 0 ')).toBe(0);
  });
  it('never rounds: more than two decimals, negatives, text and empty are not an amount', () => {
    for (const bad of ['1.234', '-5', '1e3', 'abc', '', '1.', '.5', '1,2,3x']) expect(parseThbToSatang(bad), bad).toBeNull();
  });
  it('a number too large for an exact integer is refused', () => {
    expect(parseThbToSatang('9'.repeat(20))).toBeNull();
  });
});
