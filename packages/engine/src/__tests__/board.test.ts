import { describe, expect, it } from 'vitest';
import {
  boundingBox,
  blockedPremoveCells,
  countBySymbol,
  findWinningLine,
  isBoardFull,
  nearestLegalCell,
  setStone,
  validatePlacement,
} from '../board.js';
import { resolveRule } from '../rules.js';
import type { Cell, Symbol } from '../types.js';

const classic = resolveRule({ tier: 'classic' });
const big = resolveRule({ tier: 'big' });
const inf = resolveRule({ tier: 'infinity' });

/** Dựng bàn từ danh sách quân cho test gọn hơn. */
function build(cells: Array<[number, number, Symbol]>): Record<string, Symbol> {
  let b: Record<string, Symbol> = {};
  for (const [x, y, s] of cells) b = setStone(b, x, y, s);
  return b;
}

describe('validatePlacement — bàn hữu hạn', () => {
  it('chấp nhận ô trong bàn', () => {
    expect(validatePlacement({}, classic, 2, 2).ok).toBe(true);
    expect(validatePlacement({}, big, 5, 5).ok).toBe(true);
  });

  it('từ chối ô ngoài bàn', () => {
    expect(validatePlacement({}, classic, 3, 0)).toEqual({ ok: false, error: 'out_of_bounds' });
    expect(validatePlacement({}, classic, -1, 0)).toEqual({ ok: false, error: 'out_of_bounds' });
    expect(validatePlacement({}, big, 6, 0)).toEqual({ ok: false, error: 'out_of_bounds' });
  });

  it('từ chối ô đã có quân', () => {
    const b = build([[1, 1, 'X']]);
    expect(validatePlacement(b, classic, 1, 1)).toEqual({ ok: false, error: 'occupied' });
  });

  it('từ chối toạ độ rác', () => {
    expect(validatePlacement({}, classic, 0.5, 0)).toEqual({ ok: false, error: 'invalid_coord' });
    expect(validatePlacement({}, classic, NaN, 0)).toEqual({ ok: false, error: 'invalid_coord' });
  });
});

describe('validatePlacement — bàn vô hạn', () => {
  it('cho phép đặt quân tại mọi toạ độ nguyên an toàn, kể cả nước đầu', () => {
    expect(validatePlacement({}, inf, 0, 0).ok).toBe(true);
    expect(validatePlacement({}, inf, 25, -90).ok).toBe(true);
    expect(validatePlacement({}, inf, -1, -1).ok).toBe(true);
  });

  it('vẫn chặn ô đã có quân', () => {
    const b = build([[0, 0, 'X']]);
    expect(validatePlacement(b, inf, 0, 0)).toEqual({ ok: false, error: 'occupied' });
    expect(validatePlacement(b, inf, 50, -20).ok).toBe(true);
  });

  it('bàn vô hạn không bao giờ full', () => {
    expect(isBoardFull({}, inf)).toBe(false);
  });
});

describe('findWinningLine', () => {
  it('thắng hàng ngang', () => {
    const b = build([[0, 0, 'X'], [1, 0, 'X'], [2, 0, 'X']]);
    expect(findWinningLine(b, classic, 'X', 2, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it('thắng hàng dọc', () => {
    const b = build([[1, 0, 'O'], [1, 1, 'O'], [1, 2, 'O']]);
    expect(findWinningLine(b, classic, 'O', 1, 1)).toHaveLength(3);
  });

  it('thắng đường chéo chính và chéo phụ', () => {
    const main = build([[0, 0, 'X'], [1, 1, 'X'], [2, 2, 'X']]);
    expect(findWinningLine(main, classic, 'X', 1, 1)).toHaveLength(3);
    const anti = build([[2, 0, 'X'], [1, 1, 'X'], [0, 2, 'X']]);
    expect(findWinningLine(anti, classic, 'X', 1, 1)).toHaveLength(3);
  });

  it('không tính đường bị ô rỗng xen giữa', () => {
    const b = build([[0, 0, 'X'], [2, 0, 'X'], [1, 0, 'O']]);
    expect(findWinningLine(b, classic, 'X', 0, 0)).toBeNull();
  });

  it('quét được đường thắng dài hơn winLength và lấy đoạn dài nhất', () => {
    const b = build([[0, 0, 'X'], [1, 0, 'X'], [2, 0, 'X'], [3, 0, 'X'], [4, 0, 'X']]);
    expect(findWinningLine(b, big, 'X', 2, 0)).toHaveLength(4);
  });

  it('bàn 6×6 thắng với 4 quân', () => {
    const b = build([[0, 0, 'O'], [1, 1, 'O'], [2, 2, 'O'], [3, 3, 'O']]);
    expect(findWinningLine(b, big, 'O', 3, 3)).toHaveLength(4);
    expect(findWinningLine(b, big, 'O', 3, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });

  it('trả null khi chưa đủ quân', () => {
    const b = build([[0, 0, 'X'], [1, 0, 'X']]);
    expect(findWinningLine(b, classic, 'X', 1, 0)).toBeNull();
  });
});

describe('isBoardFull', () => {
  it('bàn 3×3 đầy khi đủ 9 quân', () => {
    const b = build([
      [0, 0, 'X'], [1, 0, 'O'], [2, 0, 'X'],
      [0, 1, 'O'], [1, 1, 'X'], [2, 1, 'O'],
      [0, 2, 'X'], [1, 2, 'O'],
    ]);
    expect(isBoardFull(b, classic)).toBe(false);
    expect(isBoardFull(setStone(b, 2, 2, 'X'), classic)).toBe(true);
  });
});

describe('nearestLegalCell', () => {
  it('tìm ô hợp lệ gần nhất khi ô đích bị chiếm', () => {
    const b = build([[0, 0, 'X'], [1, 0, 'O']]);
    const cell = nearestLegalCell(b, classic, 1, 0);
    expect(cell).not.toBeNull();
    expect(cell && validatePlacement(b, classic, cell.x, cell.y).ok).toBe(true);
    expect(cell && Math.abs(cell.x - 1) <= 1 && Math.abs(cell.y) <= 1).toBe(true);
  });

  it('trả null khi bàn kín', () => {
    const cells: Array<[number, number, Symbol]> = [];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) cells.push([i, j, (i + j) % 2 ? 'X' : 'O']);
    expect(nearestLegalCell(build(cells), classic, 1, 1)).toBeNull();
  });
});

describe('blockedPremoveCells', () => {
  it('lọc đúng các ô không còn hợp lệ', () => {
    const b = build([[1, 1, 'X'], [2, 2, 'X']]);
    const cells: Cell[] = [
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(blockedPremoveCells(b, classic, cells)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('tiện ích bàn cờ', () => {
  it('countBySymbol đếm đúng', () => {
    expect(countBySymbol(build([[0, 0, 'X'], [1, 0, 'X'], [0, 1, 'O']]))).toEqual({ X: 2, O: 1 });
  });

  it('boundingBox null khi bàn trống', () => {
    expect(boundingBox({})).toBeNull();
  });

  it('boundingBox bao trọn mọi quân kể cả toạ độ âm', () => {
    const b = build([[-3, 2, 'X'], [4, -1, 'O']]);
    expect(boundingBox(b)).toEqual({ minX: -3, minY: -1, maxX: 4, maxY: 2 });
  });
});
