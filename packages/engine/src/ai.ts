import { DIRECTIONS, hasNeighbor, inBounds } from './board.js';
import { otherSymbol, type BoardRule, type Cell, type Symbol } from './types.js';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Cấp độ tối đa của não bot. */
export const MAX_LEVEL = 15;
/** Trần thời gian suy nghĩ cho một nước đi của bot khó (ms). */
export const MAX_THINK_MS = 1800;

export const isDifficulty = (value: unknown): value is Difficulty =>
  value === 'easy' || value === 'normal' || value === 'hard';

/** Điểm tuyệt đối: thắng chắc trong ply nước đi. */
export const MATE = 1_000_000;

export interface AiProfile {
  /** Độ sâu tìm kiếm tối đa (số ply). */
  depth: number;
  /** Ngân sách thời gian cho một nước đi (ms). */
  timeMs: number;
  /** Số nhánh tối đa mở ra mỗi nút tìm kiếm. */
  branching: number;
  /** Xác suất chọn nước đi kém để người chơi dễ thắng hơn. */
  blunderChance: number;
}

export interface MoveAdvice {
  /** Nước nên đánh (học được từ người chơi thắng bot, hoặc từ chính bot khi thắng). */
  good?: string[];
  /** Nước đã khiến bot thua — tránh lặp lại. */
  bad?: string[];
}

export interface AiOptions {
  advice?: MoveAdvice;
  /** Giới hạn thời gian tuỳ biến (ms); đè lên profile.timeMs. */
  timeMs?: number;
}

const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** Hồ sơ chơi theo độ khó, cộng thêm theo cấp độ bot đã học được (0-15). */
export function profileFor(difficulty: Difficulty, level = 0): AiProfile {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  if (difficulty === 'easy') {
    return {
      depth: 2 + Math.floor(l / 5),
      timeMs: 70 + l * 10,
      branching: 10,
      blunderChance: Math.max(0.1, 0.45 - l * 0.03),
    };
  }
  if (difficulty === 'normal') {
    return {
      depth: 5 + Math.floor(l / 4),
      timeMs: 250 + Math.min(400, l * 45),
      branching: 16,
      blunderChance: Math.max(0, 0.07 - l * 0.005),
    };
  }
  return {
    depth: 8 + Math.floor(l / 2),
    timeMs: Math.min(MAX_THINK_MS, 850 + l * 70),
    branching: 22,
    blunderChance: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Candidate moves                                                     */
/* ------------------------------------------------------------------ */

/**
 * Candidate nước đi cho bot. Bàn hữu hạn liệt kê mọi ô trống; bàn mở rộng lấy một vùng hữu hạn
 * quanh tâm/quân đã có để bot không cần duyệt toàn bộ lưới. Người chơi vẫn được đánh mọi ô trống.
 */
export function legalMoves(board: Record<string, Symbol>, rule: BoardRule, limit = 400): Cell[] {
  const moves: Cell[] = [];

  if (Object.keys(board).length === 0) {
    return rule.boardType === 'infinite' ? [{ x: 0, y: 0 }] : collectFinite(board, rule);
  }

  if (rule.boardType === 'finite') return collectFinite(board, rule);

  const seen = new Set<string>();
  for (const k of Object.keys(board)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const kk = `${nx},${ny}`;
        if (seen.has(kk)) continue;
        seen.add(kk);
        if (board[kk]) continue;
        if (!hasNeighbor(board, nx, ny)) continue;
        moves.push({ x: nx, y: ny });
        if (moves.length >= limit) return moves;
      }
    }
  }
  return moves;
}

function collectFinite(board: Record<string, Symbol>, rule: BoardRule): Cell[] {
  const moves: Cell[] = [];
  for (let y = 0; y < rule.size; y += 1) {
    for (let x = 0; x < rule.size; x += 1) {
      if (!inBounds(rule, x, y) || board[`${x},${y}`]) continue;
      moves.push({ x, y });
    }
  }
  return moves;
}

/* ------------------------------------------------------------------ */
/*  Internal fast board (mutable Map) + đánh giá thế cờ                 */
/* ------------------------------------------------------------------ */

type BoardMap = Map<string, Symbol>;

const key = (x: number, y: number) => `${x},${y}`;

const toMap = (board: Record<string, Symbol>): BoardMap => {
  const map: BoardMap = new Map();
  for (const [k, v] of Object.entries(board)) map.set(k, v);
  return map;
};

interface LineInfo {
  /** Số quân liền kề tính cả ô vừa xét. */
  run: number;
  /** Số đầu đầu (phía trên và phía dưới) còn trống. */
  openEnds: number;
}

/** Thông tin một hướng tại ô (x, y): độ dài đoạn quân + số đầu còn trống. */
function lineInfo(
  board: BoardMap,
  rule: BoardRule,
  symbol: Symbol,
  x: number,
  y: number,
  dx: number,
  dy: number,
): LineInfo {
  let run = 1;
  let openEnds = 0;
  for (const sign of [-1, 1]) {
    let own = 0;
    let empty = false;
    for (let i = 1; i < rule.winLength; i += 1) {
      const s = board.get(key(x + dx * sign * i, y + dy * sign * i));
      if (s === symbol) {
        own += 1;
        continue;
      }
      if (s === undefined) empty = true;
      break;
    }
    run += own;
    if (empty) openEnds += 1;
  }
  return { run, openEnds };
}

const bestLine = (
  board: BoardMap,
  rule: BoardRule,
  symbol: Symbol,
  x: number,
  y: number,
): LineInfo => {
  let best: LineInfo = { run: 1, openEnds: 0 };
  for (const [dx, dy] of DIRECTIONS) {
    const info = lineInfo(board, rule, symbol, x, y, dx, dy);
    if (info.run > best.run || (info.run === best.run && info.openEnds > best.openEnds)) {
      best = info;
    }
  }
  return best;
};

/** Đặt quân tại (x, y) có tạo đủ điều kiện thắng không. */
const completesLine = (
  board: BoardMap,
  rule: BoardRule,
  symbol: Symbol,
  x: number,
  y: number,
): boolean => {
  for (const [dx, dy] of DIRECTIONS) {
    let run = 1;
    for (const sign of [-1, 1]) {
      for (let i = 1; i < rule.winLength; i += 1) {
        if (board.get(key(x + dx * sign * i, y + dy * sign * i)) === symbol) run += 1;
        else break;
      }
    }
    if (run >= rule.winLength) return true;
  }
  return false;
};

/**
 * Trọng số đe doạ của một đoạn quân.
 * Điểm mấu chốt: đoạn chỉ còn đúng 1 đầu trống là đe doạ KHÔNG CHẶN ĐƯỢC
 * (đối thủ không có ô nào để lấp) — nên phải nặng hơn hẳn đoạn 2 đầu trống
 * vốn chỉ buộc đối thủ phải đáp.
 */
function threatWeight(run: number, openEnds: number, winLength: number): number {
  if (run >= winLength) return 100_000;
  const need = winLength - run;
  if (need <= 1) return openEnds === 1 ? 4_000 : 900;
  if (need === 2) return openEnds === 1 ? 420 : 260;
  if (need === 3) return openEnds === 1 ? 80 : 45;
  return run * 6;
}

/** Quân gần tâm giữ bàn gọn, hữu ích trên mọi chế độ. */
const centrality = (rule: BoardRule, cell: Cell): number => {
  const center = (rule.size - 1) / 2;
  const dx = rule.boardType === 'finite' ? cell.x - center : cell.x;
  const dy = rule.boardType === 'finite' ? cell.y - center : cell.y;
  return -(Math.abs(dx) + Math.abs(dy));
};

/** Điểm đánh giá thế cờ từ góc nhìn quân đang đi (symbol). */
export function evaluateBoard(board: Record<string, Symbol>, rule: BoardRule, symbol: Symbol): number {
  const map = toMap(board);
  return evaluateMap(map, rule, symbol);
}

function evaluateMap(board: BoardMap, rule: BoardRule, symbol: Symbol): number {
  let score = 0;
  let mine = 0;
  let theirs = 0;
  let myCenter = 0;
  let foeCenter = 0;
  const center = (rule.size - 1) / 2;

  for (const [k, s] of board) {
    const [x, y] = parseKey(k);
    if (s === symbol) mine += 1;
    else theirs += 1;

    if (rule.boardType === 'finite') {
      const near = Math.max(Math.abs(x - center), Math.abs(y - center));
      const weight = rule.size / 2 - near + 1;
      if (s === symbol) myCenter += weight;
      else foeCenter += weight;
    }

    for (const [dx, dy] of DIRECTIONS) {
      // Chỉ chấm mỗi đoạn tối đa một lần, tránh đếm trùng theo từng quân.
      if (board.get(key(x - dx, y - dy)) === s) continue;
      let run = 0;
      let cx = x;
      let cy = y;
      while (board.get(key(cx, cy)) === s && run < rule.winLength) {
        run += 1;
        cx += dx;
        cy += dy;
      }
      const openEnds =
        (board.get(key(cx, cy)) === undefined ? 1 : 0) +
        (board.get(key(x - dx, y - dy)) === undefined ? 1 : 0);
      const w = threatWeight(run, openEnds, rule.winLength);
      score += s === symbol ? w : -w;
    }
  }

  score += 3 * (myCenter - foeCenter);
  score += 2 * (mine - theirs);
  return score;
}

/* ------------------------------------------------------------------ */
/*  Move ordering + tìm kiếm                                           */
/* ------------------------------------------------------------------ */

/** Mọi ô trống "hữu ích": quanh quân đã đánh (bàn mở rộng) hoặc toàn bàn (bàn hữu hạn). */
function allCandidates(board: BoardMap, rule: BoardRule): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();

  if (rule.boardType === 'finite') {
    for (let y = 0; y < rule.size; y += 1) {
      for (let x = 0; x < rule.size; x += 1) {
        const k = key(x, y);
        if (board.has(k)) continue;
        seen.add(k);
        out.push({ x, y });
      }
    }
    return out;
  }

  for (const k of board.keys()) {
    const comma = k.indexOf(',');
    const x = Number(k.slice(0, comma));
    const y = Number(k.slice(comma + 1));
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        const nk = key(nx, ny);
        if (seen.has(nk) || board.has(nk)) continue;
        seen.add(nk);
        out.push({ x: nx, y: ny });
      }
    }
  }

  if (out.length === 0) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nk = key(dx, dy);
        if (seen.has(nk) || board.has(nk)) continue;
        seen.add(nk);
        out.push({ x: dx, y: dy });
      }
    }
  }
  return out;
}

const parseKey = (k: string): [number, number] => {
  const comma = k.indexOf(',');
  return [Number(k.slice(0, comma)), Number(k.slice(comma + 1))];
};

/** Nước đi "rẻ" nhất để sắp xếp thứ tự: thắng > chặn > tạo đe doạ > gần tâm. */
function cheapOrder(board: BoardMap, rule: BoardRule, symbol: Symbol, cell: Cell): number {
  const k = key(cell.x, cell.y);
  const foe = otherSymbol(symbol);
  let score = 0;

  board.set(k, symbol);
  if (completesLine(board, rule, symbol, cell.x, cell.y)) score += 5_000_000;
  board.delete(k);

  const info = bestLine(board, rule, symbol, cell.x, cell.y);
  score += info.run * 1_200 + info.openEnds * 60;

  if (completesLine(board, rule, foe, cell.x, cell.y)) score += 4_000_000;

  score += centrality(rule, cell) * 3;
  return score;
}

/** Sắp xếp và cắt nhánh theo ngân sách của hồ sơ chơi. */
function orderedCandidates(
  board: BoardMap,
  rule: BoardRule,
  symbol: Symbol,
  branching: number,
  ttMove?: Cell,
): Cell[] {
  const raw = allCandidates(board, rule);
  if (raw.length === 0) return [];

  const scored = raw.map((cell) => ({ cell, score: cheapOrder(board, rule, symbol, cell) }));
  scored.sort((a, b) => b.score - a.score || a.cell.y - b.cell.y || a.cell.x - b.cell.x);

  if (ttMove) {
    const i = scored.findIndex((s) => s.cell.x === ttMove.x && s.cell.y === ttMove.y);
    if (i > 0) {
      const [hit] = scored.splice(i, 1);
      if (hit) scored.unshift(hit);
    }
  }

  return scored.slice(0, branching).map((s) => s.cell);
}

/** Số nước thắng ngay của symbol (dùng cho phát hiện sai lầm và quiescence). */
export function winningMoves(board: Record<string, Symbol>, rule: BoardRule, symbol: Symbol): Cell[] {
  const map = toMap(board);
  return allCandidates(map, rule).filter((cell) => {
    const k = key(cell.x, cell.y);
    map.set(k, symbol);
    const win = completesLine(map, rule, symbol, cell.x, cell.y);
    map.delete(k);
    return win;
  });
}

const hasImmediateWin = (board: BoardMap, rule: BoardRule, symbol: Symbol): boolean => {
  for (const cell of allCandidates(board, rule)) {
    const k = key(cell.x, cell.y);
    board.set(k, symbol);
    const win = completesLine(board, rule, symbol, cell.x, cell.y);
    board.delete(k);
    if (win) return true;
  }
  return false;
};

interface SearchCtx {
  deadline: number;
  nodes: number;
  timeout: boolean;
  tt: Map<string, Cell>;
}

const negamax = (
  board: BoardMap,
  rule: BoardRule,
  symbol: Symbol,
  depth: number,
  alphaIn: number,
  betaIn: number,
  ply: number,
  ctx: SearchCtx,
  branching: number,
): number => {
  ctx.nodes += 1;
  if ((ctx.nodes & 127) === 0 && nowMs() > ctx.deadline) {
    ctx.timeout = true;
    return evaluateMap(board, rule, symbol);
  }

  const foe = otherSymbol(symbol);

  // Lá: mở rộng nếu bên đến lượt sắp thắng ngay — giúp bot thấy chuỗi đe doạ ngoài tầm sâu.
  if (depth <= 0) {
    // Bàn đã đầy thì hoà, không phải thua.
    if (rule.boardType === 'finite' && board.size >= rule.size * rule.size) return 0;
    if (hasImmediateWin(board, rule, symbol)) return MATE - ply;
    return evaluateMap(board, rule, symbol);
  }

  const ttKey = `${symbol}:${depth}:${hashBoard(board)}`;
  const ttMove = ctx.tt.get(ttKey);
  const moves = orderedCandidates(board, rule, symbol, branching, ttMove);

  if (moves.length === 0) {
    if (rule.boardType === 'finite' && board.size >= rule.size * rule.size) return 0;
    return evaluateMap(board, rule, symbol);
  }

  let alpha = alphaIn;
  let best = -Infinity;

  for (const cell of moves) {
    const k = key(cell.x, cell.y);
    board.set(k, symbol);

    // Đánh là xong là thắng — không cần tìm thêm.
    const score = completesLine(board, rule, symbol, cell.x, cell.y)
      ? MATE - ply
      : -negamax(board, rule, foe, depth - 1, -betaIn, -alpha, ply + 1, ctx, branching);

    board.delete(k);
    if (ctx.timeout) return best === -Infinity ? 0 : best;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= betaIn) break;
  }

  return best;
};

/** Hash ổn định của thế cờ (dùng cho bảng tra cứu thế). */
function hashBoard(board: BoardMap): string {
  const parts: string[] = [];
  for (const [k, v] of board) parts.push(`${k}${v}`);
  parts.sort();
  return parts.join('|');
}

export interface RankedMove {
  cell: Cell;
  score: number;
}

export interface SearchReport {
  ranked: RankedMove[];
  /** Độ sâu đã tìm trọn vẹn. */
  depth: number;
  nodes: number;
  timedOut: boolean;
}

/** Xếp hạng mọi nước đi hợp lệ bằng tìm kiếm negamax + alpha-beta (iterative deepening). */
export function rankMoves(
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
  profile: AiProfile,
  timeMs = profile.timeMs,
): RankedMove[] {
  return search(board, rule, symbol, profile, timeMs).ranked;
}

/** Như `rankMoves` nhưng kèm thống kê tìm kiếm (dùng cho chẩn đoán và huấn luyện). */
export function search(
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
  profile: AiProfile,
  timeMs = profile.timeMs,
): SearchReport {
  const map = toMap(board);
  const ctx: SearchCtx = {
    deadline: nowMs() + Math.max(10, timeMs),
    nodes: 0,
    timeout: false,
    tt: new Map(),
  };

  let best: RankedMove[] = [];
  let reached = 0;
  // Không tìm sâu hơn số ô còn trống — nếu không sẽ đánh giá bàn đã đầy thành "hoà" sai lệch.
  const empties = rule.boardType === 'finite' ? rule.size * rule.size - map.size : Number.POSITIVE_INFINITY;
  const maxDepth = Math.max(1, Math.min(profile.depth, empties));

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const branching = Math.max(4, Math.round(profile.branching - (depth - 1) * 1.5));
    const scored: RankedMove[] = [];
    const foe = otherSymbol(symbol);
    let alpha = -Infinity;
    let localBest: RankedMove | null = null;

    for (const cell of orderedCandidates(map, rule, symbol, profile.branching)) {
      const k = key(cell.x, cell.y);
      map.set(k, symbol);
      const score = completesLine(map, rule, symbol, cell.x, cell.y)
        ? MATE
        : -negamax(map, rule, foe, depth - 1, -Infinity, -alpha, 1, ctx, branching);
      map.delete(k);
      scored.push({ cell, score });
      if (!localBest || score > localBest.score) localBest = { cell, score };
      if (score > alpha) alpha = score;
      if (ctx.timeout) break;
    }

    if (ctx.timeout && scored.length === 0) break;
    if (localBest) ctx.tt.set(`${symbol}:${depth}:${hashBoard(toMap(board))}`, localBest.cell);

scored.sort((a, b) => b.score - a.score || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
    if (scored.length > 0 && (!ctx.timeout || best.length === 0)) {
      best = scored;
      reached = depth;
    }
    if (ctx.timeout) break;
  }

  return { ranked: best, depth: reached, nodes: ctx.nodes, timedOut: ctx.timeout };
}

/** Nước đi tốt nhất + điểm số (dùng để phân tích sai lầm khi huấn luyện). */
export function bestMove(
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
  profile: AiProfile = profileFor('normal'),
): RankedMove | null {
  const ranked = rankMoves(board, rule, symbol, profile);
  return ranked[0] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Chọn nước đi                                                        */
/* ------------------------------------------------------------------ */

const ADVICE_GAIN = 120_000;
const ADVICE_PENALTY = 150_000;
const SAFE_ZONE = -60_000;

/**
 * Chọn nước đi cho bot.
 * - hard: tìm kiếm sâu nhất, không bỏ lỡ chiến thuật.
 * - normal: tìm kiếm vừa phải, thỉnh thoảng chọn nước tương đương.
 * - easy: nông + hay chọn nước kém để người chơi dễ thắng hơn.
 * Ngoài ra áp dụng `advice` — những bài học bot đã học được từ các ván trước.
 */
export function chooseBotMove(
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
  difficulty: Difficulty = 'normal',
  rng: () => number = Math.random,
  options: AiOptions = {},
  level = 0,
): Cell | null {
  return chooseBotMoveWithProfile(
    board,
    rule,
    symbol,
    profileFor(difficulty, level),
    rng,
    { ...options, difficulty },
    difficulty === 'hard',
  );
}

/** Chọn nước đi theo hồ sơ tuỳ biến (dùng cho huấn luyện, quét tham số và bot học bài). */
export function chooseBotMoveWithProfile(
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
  profile: AiProfile,
  rng: () => number = Math.random,
  options: AiOptions & { difficulty?: Difficulty } = {},
  deterministic = false,
): Cell | null {
  const candidates = legalMoves(board, rule);
  if (candidates.length === 0) return null;

  const ranked = rankMoves(board, rule, symbol, profile, options.timeMs ?? profile.timeMs);
  if (ranked.length === 0) return candidates[0]!;

  const good = new Set(options.advice?.good ?? []);
  const bad = new Set(options.advice?.bad ?? []);
  const isLegal = new Set(candidates.map((c) => key(c.x, c.y)));

  const adjusted = ranked.map((entry) => {
    const k = key(entry.cell.x, entry.cell.y);
    let score = entry.score;
    const winningNow = score > MATE - 1000;
    const losingNow = score < SAFE_ZONE;

    if (bad.has(k) && isLegal.has(k) && !winningNow) score -= ADVICE_PENALTY;
    if (good.has(k) && isLegal.has(k) && !losingNow) score += ADVICE_GAIN;
    return { cell: entry.cell, score };
  });

  adjusted.sort((a, b) => b.score - a.score || a.cell.y - b.cell.y || a.cell.x - b.cell.x);

  // Cơ hội chơi sai: chọn trong nhóm kém nhất thay vì bốc đại, để bot yếu vẫn có
  // cơ hội thắng nhưng không tự nộp bàn thua.
  if (profile.blunderChance > 0 && rng() < profile.blunderChance) {
    const weak = adjusted.slice(Math.max(1, Math.floor(adjusted.length / 3)));
    const pool = weak.length > 0 ? weak : adjusted;
    return pool[Math.floor(rng() * pool.length)]!.cell;
  }

  // Hoà điểm tuyệt đối thì mới chọn ngẫu nhiên, để ván đấu không bị lặp lại y hệt.
  const top = adjusted[0]!;
  const tied = adjusted.filter((m) => top.score - m.score <= 1e-9);
  if (!deterministic && tied.length > 1 && rng() < 0.5) {
    return tied[Math.floor(rng() * tied.length)]!.cell;
  }
  return top.cell;
}