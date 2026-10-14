import { describe, expect, it } from 'vitest';
import { chooseBotMove, isDifficulty, legalMoves } from '../ai.js';
import { findWinningLine, setStone } from '../board.js';
import { resolveRule } from '../rules.js';
import type { BoardRule, Cell, Symbol } from '../types.js';

const classic = resolveRule({ tier: 'classic' });
const big = resolveRule({ tier: 'big' });
const inf = resolveRule({ tier: 'infinity' });

const build = (cells: Array<[number, number, Symbol]>): Record<string, Symbol> => {
  let b: Record<string, Symbol> = {};
  for (const [x, y, s] of cells) b = setStone(b, x, y, s);
  return b;
};
const at = (move: Cell | null) => (move ? `${move.x},${move.y}` : null);

/** Các ô đánh vào là thắng ngay — dùng để kiểm tra bất biến "bot phải chặn / phải thắng". */
const immediateWins = (board: Record<string, Symbol>, rule: BoardRule, symbol: Symbol): Cell[] =>
  legalMoves(board, rule).filter((cell) => {
    const next = setStone(board, cell.x, cell.y, symbol);
    return !!findWinningLine(next, rule, symbol, cell.x, cell.y);
  });

describe('legalMoves', () => {
  it('bàn 3×3 trống có 9 ô', () => {
    expect(legalMoves({}, classic)).toHaveLength(9);
  });

  it('bàn 3×3 có quân thì bớt ô', () => {
    expect(legalMoves(build([[0, 0, 'X']]), classic)).toHaveLength(8);
  });

  it('bot ưu tiên tâm làm candidate đầu tiên trên bàn vô hạn trống', () => {
    expect(legalMoves({}, inf)).toEqual([{ x: 0, y: 0 }]);
  });

  it('candidate của bot trên bàn vô hạn tập trung quanh quân đã có', () => {
    const moves = legalMoves(build([[0, 0, 'X']]), inf);
    expect(moves).toHaveLength(8);
    for (const m of moves) expect(Math.max(Math.abs(m.x), Math.abs(m.y))).toBe(1);
  });

  it('candidate của bot không chứa ô đã có quân', () => {
    const moves = legalMoves(build([[0, 0, 'X'], [1, 0, 'X']]), inf);
    expect(at(moves.find((m) => m.x === 0 && m.y === 0))).toBeNull();
  });

  it('bàn đầy thì không còn nước', () => {
    const full: Array<[number, number, Symbol]> = [];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) full.push([i, j, (i + j) % 2 ? 'X' : 'O']);
    expect(legalMoves(build(full), classic)).toHaveLength(0);
  });
});

describe('chooseBotMove — luôn hợp lệ', () => {
  it('trả về ô hợp lệ ở mọi chế độ', () => {
    const b3 = build([[0, 0, 'O'], [1, 1, 'X']]);
    expect(at(chooseBotMove(b3, classic, 'X', 'hard'))).not.toBeNull();

    const b6 = build([[0, 0, 'O'], [1, 1, 'X'], [2, 2, 'O'], [3, 3, 'X']]);
    expect(at(chooseBotMove(b6, big, 'X', 'hard'))).not.toBeNull();

    const bi = build([[0, 0, 'O'], [1, 0, 'X']]);
    const move = chooseBotMove(bi, inf, 'X', 'hard');
    expect(move).not.toBeNull();
    expect(Math.max(Math.abs(move!.x), Math.abs(move!.y))).toBe(1);
  });

  it('trả null khi bàn không còn nước', () => {
    const full: Array<[number, number, Symbol]> = [];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) full.push([i, j, (i + j) % 2 ? 'X' : 'O']);
    expect(chooseBotMove(build(full), classic, 'X')).toBeNull();
  });
});

describe('chooseBotMove — chiến thuật', () => {
  it('ưu tiên thắng ngay', () => {
    // X đang có (0,0),(1,0) → đặt (2,0) là thắng
    const board = build([[0, 0, 'X'], [1, 0, 'X'], [1, 1, 'O'], [0, 1, 'O'], [2, 2, 'X']]);
    expect(at(chooseBotMove(board, classic, 'X', 'hard'))).toBe('2,0');
  });

  it('chặn nước thắng của đối thủ', () => {
    // X có (0,0),(1,0),(1,1) → có BA nước thắng ngay: (2,0) hàng, (1,2) cột, (2,2) chéo.
    // O chỉ chặn được một, nhưng bắt buộc phải chặn đúng một.
    const board = build([[0, 0, 'X'], [1, 0, 'X'], [0, 1, 'O'], [1, 1, 'X'], [2, 1, 'O']]);
    const move = chooseBotMove(board, classic, 'O', 'hard');
    expect(move).not.toBeNull();
    // Bot phải chặn đúng MỘT ô mà X có thể thắng ngay (X có 3 ô nên không thể chặn hết).
    const xWins = immediateWins(board, classic, 'X').map(at);
    expect(xWins).toContain(at(move));
  });

  it('thắng quan trọng hơn chặn', () => {
    const board = build([[0, 0, 'X'], [1, 0, 'X'], [2, 1, 'O'], [1, 2, 'O']]);
    const move = chooseBotMove(board, classic, 'X', 'hard');
    expect(at(move)).toBe('2,0');
  });

  it('chặn nước thắng của đối thủ ở bàn 6×6 với 4 quân', () => {
    // X có (0,0),(1,0),(2,0) → đặt (3,0) là thắng. Lượt O nên phải chặn.
    const board = build([[0, 0, 'X'], [1, 0, 'X'], [2, 0, 'X'], [0, 1, 'O'], [1, 1, 'O']]);
    expect(at(chooseBotMove(board, big, 'O', 'hard'))).toBe('3,0');
  });

  it('ưu tiên ô trung tâm khi bàn trống', () => {
    expect(at(chooseBotMove({}, classic, 'X', 'hard'))).toBe('1,1');
  });

  it('hard tạo fork khi có thể', () => {
    // X có (0,0),(1,2). Đặt (1,0) tạo đồng thời mối đe doạ (2,0) theo hàng và (1,1) theo cột.
    // O đặt ở (0,1),(0,2),(2,2) để không có nước thắng ngay nào.
    const board = build([[0, 0, 'X'], [1, 2, 'X'], [0, 1, 'O'], [0, 2, 'O'], [2, 2, 'O']]);
    expect(at(chooseBotMove(board, classic, 'X', 'hard'))).toBe('1,0');
  });

  it('ưu tiên thắng ngay thay vì tạo fork', () => {
    // X có (0,0),(0,2) nên đặt (0,1) thắng ngay, dù (1,1) cũng tạo nhiều đe doạ
    const board = build([[0, 0, 'X'], [0, 2, 'X'], [2, 0, 'O'], [1, 1, 'O'], [2, 2, 'O']]);
    expect(at(chooseBotMove(board, classic, 'X', 'hard'))).toBe('0,1');
  });

  it('easy đôi khi bỏ qua bước chặn nhưng không đánh ô bất hợp lệ', () => {
    const board = build([[0, 0, 'X'], [1, 0, 'X'], [1, 1, 'O'], [0, 1, 'O']]);
    for (let i = 0; i < 30; i += 1) {
      const move = chooseBotMove(board, classic, 'O', 'easy');
      expect(move).not.toBeNull();
      expect(board[`${move!.x},${move!.y}`]).toBeUndefined();
    }
  });
});

describe('isDifficulty', () => {
  it('chặn giá trị lạ', () => {
    expect(isDifficulty('easy')).toBe(true);
    expect(isDifficulty('normal')).toBe(true);
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('impossible')).toBe(false);
    expect(isDifficulty(undefined)).toBe(false);
  });
});
