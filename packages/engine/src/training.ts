import { findWinningLine, setStone } from './board.js';
import { MAX_LEVEL, winningMoves, type MoveAdvice } from './ai.js';
import { cellKey, otherSymbol, type BoardRule, type Cell, type Move, type Symbol } from './types.js';

export type LessonKind = 'good' | 'bad';

export interface Lesson {
  /** Khoá của thế cờ (đã chuẩn hoá). */
  key: string;
  /** Ô đã đánh, dạng "x,y". */
  move: string;
  kind: LessonKind;
  /** Độ tin cậy 0..1. */
  weight: number;
  at: number;
}

export interface BrainStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Số bài học đang lưu. */
  lessons: number;
  /** Cấp độ 0..10 — cấp cao thì bot tìm kiếm sâu và chơi chắc hơn. */
  level: number;
  xp: number;
}

export interface BotBrain {
  version: 1;
  stats: BrainStats;
  lessons: Lesson[];
}

const MAX_LESSONS = 4000;
const MAX_ADVICE = 3;

export const emptyStats = (): BrainStats => ({
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  lessons: 0,
  level: 0,
  xp: 0,
});

export const createBrain = (): BotBrain => ({ version: 1, stats: emptyStats(), lessons: [] });

/**
 * Khoá thế cờ chuẩn hoá: dịch toạ độ về gốc trên-trái rồi sắp xếp, kèm luật chơi và
 * quân đang đi. Nhờ vậy bot nhận ra "cùng một tình huống" dù đánh ở toạ độ khác.
 */
export function positionKey(board: Record<string, Symbol>, rule: BoardRule, turn?: Symbol): string {
  const keys = Object.keys(board);
  let minX = Infinity;
  let minY = Infinity;
  for (const k of keys) {
    const comma = k.indexOf(',');
    const x = Number(k.slice(0, comma));
    const y = Number(k.slice(comma + 1));
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
  }

  const parts = keys
    .map((k) => {
      const comma = k.indexOf(',');
      const x = Number(k.slice(0, comma)) - minX;
      const y = Number(k.slice(comma + 1)) - minY;
      return `${x},${y}${board[k]}`;
    })
    .sort();

  return `${rule.boardType}:${rule.size}:${rule.winLength}|${turn ?? '-'}|${parts.join(' ')}`;
}

/** Gợi ý cho thế cờ hiện tại, lấy từ các bài học bot đã tích luỹ. */
export function adviceFor(
  brain: BotBrain | null | undefined,
  board: Record<string, Symbol>,
  rule: BoardRule,
  symbol: Symbol,
): MoveAdvice | undefined {
  if (!brain || brain.lessons.length === 0) return undefined;
  const key = positionKey(board, rule, symbol);
  const good: string[] = [];
  const bad: string[] = [];

  for (const lesson of brain.lessons) {
    if (lesson.key !== key) continue;
    (lesson.kind === 'good' ? good : bad).push(lesson.move);
    if (good.length >= MAX_ADVICE && bad.length >= MAX_ADVICE) break;
  }

  if (good.length === 0 && bad.length === 0) return undefined;
  return { good, bad };
}

export interface MatchAnalysisInput {
  moves: Move[];
  rule: BoardRule;
  /** Ký hiệu quân của bot trong ván này. */
  botSymbol: Symbol;
  /** Bot thắng? null nghĩa là hoà. */
  botWon: boolean | null;
}

/**
 * Rút kinh nghiệm từ một ván đã đấu:
 * - Bot thua: ghi nước mình đã đi khiến thua là "sai"; ghi nước người chơi thắng bot
 *   đánh là "đúng" để bot học theo thói quen người chơi.
 * - Bot thắng: củng cố chính những nước bot đã đánh.
 * - Bot bỏ lỡ cơ hội thắng ngay cũng bị ghi là sai.
 */
export function analyzeMatch(input: MatchAnalysisInput): Lesson[] {
  const { moves, rule, botSymbol, botWon } = input;
  const foe = otherSymbol(botSymbol);
  const lessons: Lesson[] = [];
  let board: Record<string, Symbol> = {};

  for (const move of moves) {
    const key = positionKey(board, rule, move.symbol);
    const cell = cellKey(move.x, move.y);

    if (move.symbol === botSymbol) {
      const hadWin = winningMoves(board, rule, botSymbol).length > 0;
      const next = setStone(board, move.x, move.y, botSymbol);
      const wonItself = !!findWinningLine(next, rule, botSymbol, move.x, move.y);
      const blunder = winningMoves(next, rule, foe).length > 0;

      if (blunder) {
        lessons.push({ key, move: cell, kind: 'bad', weight: 1, at: move.at });
      } else if (hadWin && !wonItself) {
        lessons.push({ key, move: cell, kind: 'bad', weight: 0.7, at: move.at });
      } else if (botWon) {
        lessons.push({ key, move: cell, kind: 'good', weight: wonItself ? 0.8 : 0.45, at: move.at });
      }
    } else if (botWon === false) {
      const next = setStone(board, move.x, move.y, foe);
      const decisive = winningMoves(next, rule, foe).length > 0;
      lessons.push({ key, move: cell, kind: 'good', weight: decisive ? 1 : 0.6, at: move.at });
    }

    board = setStone(board, move.x, move.y, move.symbol);
  }

  return lessons;
}

function blend(existing: Lesson, incoming: Lesson): void {
  if (existing.kind === incoming.kind) {
    existing.weight = Math.min(1, existing.weight * 0.85 + incoming.weight * 0.5);
  } else {
    existing.weight *= 0.6;
    if (existing.weight < 0.15) {
      existing.kind = incoming.kind;
      existing.weight = incoming.weight;
    }
  }
  existing.at = Math.max(existing.at, incoming.at);
}

/** Gộp bài học mới vào não bot, đồng thời cập nhật thống kê và cấp độ. */
export function learn(brain: BotBrain, lessons: Lesson[], result: 'win' | 'loss' | 'draw'): BotBrain {
  const merged = new Map<string, Lesson>();
  for (const lesson of [...brain.lessons, ...lessons]) {
    const id = `${lesson.key}>${lesson.move}`;
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { ...lesson });
      continue;
    }
    blend(existing, lesson);
  }

  const stats = { ...brain.stats };
  stats.games += 1;
  if (result === 'win') {
    stats.wins += 1;
    stats.xp += 25;
  } else if (result === 'loss') {
    stats.losses += 1;
    stats.xp += 3;
  } else {
    stats.draws += 1;
    stats.xp += 10;
  }
  stats.level = Math.max(0, Math.min(MAX_LEVEL, Math.floor(stats.xp / 150)));

  const kept = [...merged.values()]
    .sort((a, b) => b.weight - a.weight || b.at - a.at)
    .slice(0, MAX_LESSONS);

  stats.lessons = kept.length;
  return { version: 1, stats, lessons: kept };
}

/** Chuẩn hoá não bot khi đọc từ đĩa (bỏ dữ liệu rác, giới hạn kích thước). */
export function normalizeBrain(raw: unknown): BotBrain {
  if (!raw || typeof raw !== 'object') return createBrain();
  const input = raw as Partial<BotBrain>;
  const lessons = Array.isArray(input.lessons)
    ? input.lessons
        .filter(
          (l): l is Lesson =>
            !!l && typeof l.key === 'string' && typeof l.move === 'string' && (l.kind === 'good' || l.kind === 'bad'),
        )
        .map((l) => ({
          key: l.key,
          move: l.move,
          kind: l.kind,
          weight: Math.max(0.05, Math.min(1, Number(l.weight) || 0.5)),
          at: Number(l.at) || 0,
        }))
        .slice(0, MAX_LESSONS)
    : [];

  const stats = { ...emptyStats(), ...(input.stats ?? {}) };
  stats.games = Math.max(0, Number(stats.games) || 0);
  stats.wins = Math.max(0, Number(stats.wins) || 0);
  stats.losses = Math.max(0, Number(stats.losses) || 0);
  stats.draws = Math.max(0, Number(stats.draws) || 0);
  stats.xp = Math.max(0, Number(stats.xp) || 0);
  stats.level = Math.max(0, Math.min(MAX_LEVEL, Number(stats.level) || 0));
  stats.lessons = lessons.length;

  return { version: 1, stats, lessons };
}

export interface SelfTrainResult {
  brain: BotBrain;
  results: { win: number; loss: number; draw: number };
}

export type SelfTrainProgress = (done: number, total: number) => void;

/**
 * Tự huấn luyện: cho bot đấu chính nó (đội bot đỏ với đội bot xanh) rồi tự rút
 * kinh nghiệm từ các ván đó. Dùng để "train bot" ngoại tuyến mà không cần người chơi.
 * `onGame` được gọi sau mỗi ván để báo tiến độ.
 */
export function selfTrain(
  brain: BotBrain,
  rule: BoardRule,
  games: number,
  play: (board: Record<string, Symbol>, rule: BoardRule, symbol: Symbol, level: number) => Cell | null,
  startAt = Date.now(),
  onGame?: SelfTrainProgress,
): SelfTrainResult {
  const results = { win: 0, loss: 0, draw: 0 };
  let current = brain;

  for (let g = 0; g < games; g += 1) {
    let board: Record<string, Symbol> = {};
    let symbol: Symbol = 'X';
    let seq = 0;
    const moves: Move[] = [];
    let botWon: boolean | null = null;
    let finished = false;

    for (let ply = 0; ply < 64 && !finished; ply += 1) {
      const cell = play(board, rule, symbol, current.stats.level);
      if (!cell) break;
      moves.push({
        seq: ++seq,
        playerId: symbol === 'X' ? 'self:x' : 'self:o',
        symbol,
        x: cell.x,
        y: cell.y,
        at: startAt + seq,
        source: 'play',
      });
      board = setStone(board, cell.x, cell.y, symbol);
      if (findWinningLine(board, rule, symbol, cell.x, cell.y)) {
        botWon = symbol === 'X';
        finished = true;
      } else if (Object.keys(board).length >= (rule.boardType === 'finite' ? rule.size ** 2 : 200)) {
        botWon = null;
        finished = true;
      }
      symbol = otherSymbol(symbol);
    }

    if (moves.length) {
      const result = botWon === null ? 'draw' : botWon ? 'win' : 'loss';
      results[result] += 1;
      current = learn(current, analyzeMatch({ moves, rule, botSymbol: 'X', botWon }), result);
    }
    onGame?.(g + 1, games);
  }

  return { brain: current, results };
}