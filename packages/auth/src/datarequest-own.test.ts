import { describe, expect, it } from 'vitest';
import { can } from './index';

// F01-T33: a player makes and reads their own data requests (PDPA-01-AC3, AC4).
describe('datarequest.own', () => {
  it('belongs to the player role (every club person also holds it, D115) and the owner', () => {
    expect(can(['player'], 'datarequest.own')).toBe(true);
    expect(can(['owner', 'player'], 'datarequest.own')).toBe(true);
  });
  it('is not held by a role without player, and handling stays with staff', () => {
    expect(can(['accountant'], 'datarequest.own')).toBe(false);
    expect(can([], 'datarequest.own')).toBe(false);
    expect(can(['player'], 'datarequest.handle')).toBe(false);
  });
});

// F01-T31b: confirming or rejecting an imported-player claim is for front desk and owner (D105).
describe('claim.handle', () => {
  it('front desk and owner hold it; a player, coach and accountant do not', () => {
    expect(can(['front_desk'], 'claim.handle')).toBe(true);
    expect(can(['owner'], 'claim.handle')).toBe(true);
    for (const r of ['player', 'coach', 'accountant'] as const) expect(can([r], 'claim.handle'), r).toBe(false);
  });
});
