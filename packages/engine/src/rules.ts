import type { BoardRule, Tier } from './types.js';

export interface TierDefaults {
  tier: Tier;
  boardType: 'finite' | 'infinite';
  size: number;
  defaultWinLength: number;
  minWinLength: number;
  maxWinLength: number;
  placement: 'free' | 'adjacent';
  label: string;
  description: string;
}

export const TIERS: Record<Tier, TierDefaults> = {
  classic: {
    tier: 'classic',
    boardType: 'finite',
    size: 3,
    defaultWinLength: 3,
    minWinLength: 3,
    maxWinLength: 3,
    placement: 'free',
    label: 'Thắng 3',
    description: 'Bàn 3×3. Ai xếp được 3 quân liền kề là thắng. Bàn đầy mà không ai thắng thì hoà.',
  },
  big: {
    tier: 'big',
    boardType: 'finite',
    size: 6,
    defaultWinLength: 4,
    minWinLength: 3,
    maxWinLength: 6,
    placement: 'free',
    label: 'Thắng 4',
    description: 'Bàn 6×6. Ai xếp được 4 quân liền kề là thắng.',
  },
  infinity: {
    tier: 'infinity',
    boardType: 'infinite',
    size: 0,
    defaultWinLength: 5,
    minWinLength: 3,
    maxWinLength: 9,
    placement: 'free',
    label: 'Thắng 5',
    description: 'Bàn mở rộng không giới hạn ô. Ai xếp được 5 quân liền kề là thắng. Đánh ở bất kỳ ô trống nào.',
  },
};

export const TIER_IDS = Object.keys(TIERS) as Tier[];

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TIERS, value);
}

export interface ResolveRuleInput {
  tier: Tier;
  winLength?: number | null;
}

/** Chuẩn hoá cấu hình luật từ input không tin cậy (client/network). */
export function resolveRule(input: ResolveRuleInput): BoardRule {
  const def = TIERS[input.tier];
  const raw = input.winLength;
  const winLength =
    raw === undefined || raw === null || !Number.isFinite(raw)
      ? def.defaultWinLength
      : Math.min(def.maxWinLength, Math.max(def.minWinLength, Math.trunc(raw as number)));

  return {
    tier: def.tier,
    boardType: def.boardType,
    size: def.size,
    winLength,
    placement: def.placement,
  };
}

/** Bàn vô hạn không có "full", dùng bán kính hiển thị mặc định. */
export const INFINITE_VIEW_RADIUS = 4;
