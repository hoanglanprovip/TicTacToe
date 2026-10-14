import { describe, expect, it } from 'vitest';
import { resolveRule, TIERS, isTier } from '../rules.js';

describe('rules', () => {
  it('mặc định đúng theo bảng PROJECT_SPEC', () => {
    expect(resolveRule({ tier: 'classic' })).toMatchObject({ size: 3, winLength: 3, boardType: 'finite' });
    expect(resolveRule({ tier: 'big' })).toMatchObject({ size: 6, winLength: 4, boardType: 'finite' });
    expect(resolveRule({ tier: 'infinity' })).toMatchObject({
      size: 0,
      winLength: 5,
      boardType: 'infinite',
      placement: 'free',
    });
  });

  it('clamp winLength về khoảng hợp lệ', () => {
    expect(resolveRule({ tier: 'classic', winLength: 9 }).winLength).toBe(3);
    expect(resolveRule({ tier: 'big', winLength: 1 }).winLength).toBe(3);
    expect(resolveRule({ tier: 'big', winLength: 99 }).winLength).toBe(6);
    expect(resolveRule({ tier: 'infinity', winLength: 4 }).winLength).toBe(4);
  });

  it('bỏ qua winLength rác', () => {
    expect(resolveRule({ tier: 'big', winLength: null }).winLength).toBe(TIERS.big.defaultWinLength);
    expect(resolveRule({ tier: 'big', winLength: NaN }).winLength).toBe(4);
    expect(resolveRule({ tier: 'big', winLength: 3.9 }).winLength).toBe(3);
  });

  it('isTier chặn tier giả', () => {
    expect(isTier('classic')).toBe(true);
    expect(isTier('infinity')).toBe(true);
    expect(isTier('__proto__')).toBe(false);
    expect(isTier('nope')).toBe(false);
    expect(isTier(123)).toBe(false);
  });
});
