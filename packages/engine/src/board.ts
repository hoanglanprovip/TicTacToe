import { cellKey, type BoardRule, type Cell, type PlacementResult, type Symbol } from './types.js';

export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export const emptyBoard = (): Record<string, Symbol> => ({});

export const getStone = (board: Record<string, Symbol>, x: number, y: number): Symbol | undefined =>
  board[cellKey(x, y)];

export const setStone = (
  board: Record<string, Symbol>,
  x: number,
  y: number,
  symbol: Symbol,
): Record<string, Symbol> => ({ ...board, [cellKey(x, y)]: symbol });

export const removeStone = (board: Record<string, Symbol>, x: number, y: number): Record<string, Symbol> => {
  const next = { ...board };
  delete next[cellKey(x, y)];
  return next;
};

export const countStones = (board: Record<string, Symbol>): number => Object.keys(board).length;

export const boardCells = (board: Record<string, Symbol>): Cell[] =>
  Object.entries(board).map(([key, symbol]) => {
    const [x, y] = key.split(',').map(Number) as [number, number];
    return { x, y, symbol } as Cell & { symbol: Symbol };
  });

export const countBySymbol = (board: Record<string, Symbol>): Record<Symbol, number> => {
  const out: Record<Symbol, number> = { X: 0, O: 0 };
  for (const symbol of Object.values(board)) out[symbol] += 1;
  return out;
};

export const isEmpty = (board: Record<string, Symbol>): boolean => countStones(board) === 0;

export const inBounds = (rule: BoardRule, x: number, y: number): boolean =>
  rule.boardType === 'finite' && x >= 0 && y >= 0 && x < rule.size && y < rule.size;

export const totalCells = (rule: BoardRule): number => (rule.boardType === 'finite' ? rule.size ** 2 : Infinity);

export const isBoardFull = (board: Record<string, Symbol>, rule: BoardRule): boolean =>
  rule.boardType === 'finite' && countStones(board) >= totalCells(rule);

/** Ô (x,y) có ít nhất một quân trong 8 hướng kề (khoảng cách Chebyshev = 1). */
export const hasNeighbor = (board: Record<string, Symbol>, x: number, y: number): boolean => {
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    if (getStone(board, x + dx, y + dy)) return true;
  }
  return false;
};

/** Bốn góc của hình chữ nhật bao trọn mọi quân đã đánh — dùng cho minimap. */
export function boundingBox(
  board: Record<string, Symbol>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of Object.keys(board)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

export function validatePlacement(
  board: Record<string, Symbol>,
  rule: BoardRule,
  x: number,
  y: number,
): PlacementResult {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return { ok: false, error: 'invalid_coord' };
  if (getStone(board, x, y)) return { ok: false, error: 'occupied' };

  if (rule.boardType === 'finite') {
    return inBounds(rule, x, y) ? { ok: true } : { ok: false, error: 'out_of_bounds' };
  }

  // Infinite mode permits any safe integer coordinate; only occupied cells are illegal.
  return { ok: true };
}

export const PLACEMENT_ERROR_VI: Record<string, string> = {
  invalid_coord: 'Toạ độ không hợp lệ.',
  occupied: 'Ô này đã có quân rồi.',
  out_of_bounds: 'Ô này nằm ngoài bàn cờ.',
};

/**
 * Quét 4 hướng xuyên qua ô vừa đánh.
 * Trả về đường thắng dài nhất tìm được, hoặc null.
 */
export function findWinningLine(
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
  cx: number,
  cy: number,
): Cell[] | null {
  const len = rule.winLength;
  let best: Cell[] | null = null;

  for (const [dx, dy] of DIRECTIONS) {
    let start = 0;
    while (getStone(board, cx - (start + 1) * dx, cy - (start + 1) * dy) === symbol) start += 1;

    let end = 0;
    while (getStone(board, cx + (end + 1) * dx, cy + (end + 1) * dy) === symbol) end += 1;

    const runLength = start + end + 1;
    if (runLength < len) continue;

    const line: Cell[] = [];
    for (let i = start; i > start - len; i -= 1) {
      line.push({ x: cx - i * dx, y: cy - i * dy });
    }
    if (!best || line.length > best.length) best = line;
  }
  return best;
}

/** Ô hợp lệ gần nhất với (x,y) — dùng cho tuỳ chọn autoRelocate của pre-move. */
export function nearestLegalCell(board: Record<string, Symbol>, rule: BoardRule, x: number, y: number): Cell | null {
  const RING = 40;
  for (let r = 0; r <= RING; r += 1) {
    let best: Cell | null = null;
    let bestDist = Infinity;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!validatePlacement(board, rule, nx, ny).ok) continue;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: nx, y: ny };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Những ô trong hàng đợi pre-move đã không còn hợp lệ (bị đối thủ chiếm hoặc vi phạm luật). */
export function blockedPremoveCells(board: Record<string, Symbol>, rule: BoardRule, cells: Cell[]): Cell[] {
  return cells.filter((c) => !validatePlacement(board, rule, c.x, c.y).ok);
}
