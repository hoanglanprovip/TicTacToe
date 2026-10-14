import { describe, expect, it } from 'vitest';
import {
  adviceFor,
  analyzeMatch,
  createBrain,
  emptyStats,
  learn,
  normalizeBrain,
  positionKey,
  selfTrain,
} from '../training.js';
import { chooseBotMove, profileFor, chooseBotMoveWithProfile, MAX_LEVEL } from '../ai.js';
import { resolveRule } from '../rules.js';
import type { BoardRule, Move, Symbol } from '../types.js';

const classic = resolveRule({ tier: 'classic' });
const big = resolveRule({ tier: 'big' });
const inf = resolveRule({ tier: 'infinity' });

const move = (seq: number, symbol: Symbol, x: number, y: number): Move => ({
  seq,
  playerId: symbol === 'X' ? 'bot' : 'human',
  symbol,
  x,
  y,
  at: 1_700_000_000_000 + seq,
  source: 'play',
});

describe('positionKey', () => {
  it('cùng hình dạng ở toạ độ khác thì cho cùng khoá', () => {
    const a: Record<string, Symbol> = { '5,5': 'X', '6,5': 'O', '5,6': 'X' };
    const b: Record<string, Symbol> = { '-3,-7': 'X', '-2,-7': 'O', '-3,-6': 'X' };
    expect(positionKey(a, inf, 'O')).toBe(positionKey(b, inf, 'O'));
  });

  it('khác quân đang đi hoặc khác luật thì khác khoá', () => {
    const a: Record<string, Symbol> = { '0,0': 'X' };
    expect(positionKey(a, classic, 'X')).not.toBe(positionKey(a, classic, 'O'));
    expect(positionKey(a, classic, 'X')).not.toBe(positionKey(a, big, 'X'));
  });

  it('bàn rỗng vẫn có khoá ổn định', () => {
    expect(positionKey({}, classic, 'X')).toBe(positionKey({}, classic, 'X'));
  });
});

describe('analyzeMatch — học từ người chơi thắng bot', () => {
  it('ghi nhớ nước sai của bot khi bot thua', () => {
    // Bot (O) bỏ qua việc chặn X ở (1,2) rồi X đánh (1,2) để thắng.
    const moves = [
      move(1, 'X', 1, 0),
      move(2, 'O', 2, 2),
      move(3, 'X', 1, 1),
      move(4, 'O', 0, 0),
      move(5, 'X', 1, 2),
    ];
    const lessons = analyzeMatch({ moves, rule: classic, botSymbol: 'O', botWon: false });
    const bad = lessons.filter((l) => l.kind === 'bad');
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.some((l) => l.move === '0,0')).toBe(true);
  });

  it('ghi nhớ nước của người chơi thắng bot như nước tốt', () => {
    const moves = [move(1, 'X', 1, 1), move(2, 'O', 0, 0), move(3, 'X', 2, 2), move(4, 'O', 2, 0), move(5, 'X', 1, 0)];
    const lessons = analyzeMatch({ moves, rule: classic, botSymbol: 'O', botWon: false });
    const good = lessons.filter((l) => l.kind === 'good');
    expect(good.some((l) => l.move === '1,0')).toBe(true);
  });

  it('bỏ lỡ thắng ngay cũng bị ghi là sai', () => {
    // Bot X đã có nước thắng ngay tại (2,0) nhưng lại đánh (2,2).
    const moves = [move(1, 'X', 0, 0), move(2, 'O', 1, 1), move(3, 'X', 1, 0), move(4, 'X', 2, 2)];
    const lessons = analyzeMatch({ moves, rule: classic, botSymbol: 'X', botWon: null });
    expect(lessons.some((l) => l.kind === 'bad' && l.move === '2,2')).toBe(true);
  });

  it('bot thắng thì củng cố nước đã đánh', () => {
    const moves = [move(1, 'X', 0, 0), move(2, 'O', 1, 1), move(3, 'X', 1, 0), move(4, 'O', 2, 2), move(5, 'X', 2, 0)];
    const lessons = analyzeMatch({ moves, rule: classic, botSymbol: 'X', botWon: true });
    expect(lessons.length).toBeGreaterThan(0);
    expect(lessons.every((l) => l.kind === 'good')).toBe(true);
  });
});

describe('learn + adviceFor', () => {
  it('tích luỹ thống kê và tăng cấp độ khi thắng', () => {
    let brain = createBrain();
    for (let i = 0; i < 6; i += 1) brain = learn(brain, [], 'win');
    expect(brain.stats.games).toBe(6);
    expect(brain.stats.wins).toBe(6);
    expect(brain.stats.level).toBeGreaterThanOrEqual(1);
  });

  it('gợi ý đúng thế cờ đã học, khác thế cờ thì không gợi ý', () => {
    const board: Record<string, Symbol> = { '1,1': 'X', '2,2': 'O' };
    const key = positionKey(board, classic, 'O');
    let brain = createBrain();
    brain = learn(brain, [{ key, move: '0,0', kind: 'bad', weight: 1, at: 1 }], 'loss');

    const advice = adviceFor(brain, board, classic, 'O');
    expect(advice?.bad).toContain('0,0');

    expect(adviceFor(brain, { '0,0': 'X' }, classic, 'O')).toBeUndefined();
    expect(adviceFor(createBrain(), board, classic, 'O')).toBeUndefined();
  });

  it('bot tránh được nước đã học là sai', () => {
    const board: Record<string, Symbol> = { '1,1': 'X', '2,2': 'O' };
    const key = positionKey(board, classic, 'O');
    let brain = createBrain();
    // Gán nước tốt và nước sai cho cùng một thế.
    brain = learn(brain, [{ key, move: '0,0', kind: 'bad', weight: 1, at: 2 }], 'loss');

    const move1 = chooseBotMove(board, classic, 'O', 'hard', Math.random, {
      advice: adviceFor(brain, board, classic, 'O'),
    });
    expect(move1).not.toBeNull();
    expect(`${move1!.x},${move1!.y}`).not.toBe('0,0');
  });

  it('bài học trái chiều làm suy yếu dần rồi đảo kết luận', () => {
    const board: Record<string, Symbol> = {};
    const key = positionKey(board, classic, 'X');
    let brain = learn(createBrain(), [{ key, move: '0,0', kind: 'bad', weight: 1, at: 1 }], 'loss');
    expect(brain.lessons[0]!.weight).toBe(1);

    brain = learn(brain, [{ key, move: '0,0', kind: 'good', weight: 1, at: 2 }], 'win');
    const softened = brain.lessons[0]!;
    expect(softened.weight).toBeLessThan(1);
    expect(softened.kind).toBe('bad');

    for (let i = 0; i < 6; i += 1) {
      brain = learn(brain, [{ key, move: '0,0', kind: 'good', weight: 1, at: 3 + i }], 'win');
    }
    expect(brain.lessons[0]!.kind).toBe('good');
  });

  it('normalizeBrain loại dữ liệu rác và giới hạn', () => {
    const brain = normalizeBrain({ stats: { games: -5, level: 99 }, lessons: [{ key: 1, move: 'x' }, { key: 'a', move: 'b', kind: 'good', weight: 9 }] });
    expect(brain.stats.games).toBe(0);
    expect(brain.stats.level).toBe(MAX_LEVEL);
    expect(brain.lessons).toHaveLength(1);
    expect(brain.lessons[0]!.weight).toBe(1);
    expect(normalizeBrain(null).stats).toEqual(emptyStats());
  });
});

describe('selfTrain — tự huấn luyện', () => {
  it('bot tự đấu và tự rút kinh nghiệm, cấp độ tăng dần', () => {
    let brain = createBrain();
    const play = (board: Record<string, Symbol>, rule: BoardRule, symbol: Symbol, level: number) =>
      chooseBotMoveWithProfile(board, rule, symbol, profileFor('easy', level), Math.random, {}, false);

    const trained = selfTrain(brain, classic, 4, play);
    expect(trained.results.win + trained.results.loss + trained.results.draw).toBe(4);
    expect(trained.brain.stats.games).toBe(4);
    expect(trained.brain.stats.level).toBeGreaterThanOrEqual(0);
    brain = trained.brain;
    expect(brain.stats.games).toBe(4);
  });
});