/**
 * Chạy huấn luyện trong worker thread để KHÔNG chặn event loop của server
 * (game, lobby, timer, nhật ký vẫn phản hồi bình thường trong lúc train).
 *
 * Worker nhận não bot + tuỳ chọn, gửi tiến độ từng ván và trả não bot mới về.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { chooseBotMoveWithProfile, profileFor, selfTrain, resolveRule, isDifficulty, isTier, createBrain, normalizeBrain, type BotBrain, type BoardRule, type Cell, type Difficulty, type Symbol } from '@tt/engine';

export interface TrainWorkerInput {
  brain: unknown;
  games: number;
  tier: string;
  level: string;
  opponent: string;
  seed: number;
}

const input = workerData as TrainWorkerInput;

const makeRng = (seed: number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

try {
  const brain: BotBrain = input.brain ? normalizeBrain(input.brain) : createBrain();
  const rule: BoardRule = resolveRule({ tier: isTier(input.tier) ? input.tier : 'classic' });
  const level: Difficulty = isDifficulty(input.level) ? input.level : 'hard';
  const opponent: Difficulty = isDifficulty(input.opponent) ? input.opponent : 'easy';
  const rng = makeRng(input.seed);

  const play = (
    board: Record<string, Symbol>,
    currentRule: BoardRule,
    symbol: Symbol,
    brainLevel: number,
  ): Cell | null => {
    const useWeak = rng() < 0.5;
    return chooseBotMoveWithProfile(board, currentRule, symbol, profileFor(useWeak ? opponent : level, brainLevel), rng, {}, false);
  };

  const startedAt = Date.now();
  const trained = selfTrain(brain, rule, input.games, play, Date.now() - input.games * 1000, (done, total) => {
    parentPort?.postMessage({ type: 'progress', done, total });
  });

  parentPort?.postMessage({
    type: 'done',
    brain: trained.brain,
    results: trained.results,
    stats: trained.brain.stats,
    tookMs: Date.now() - startedAt,
  });
} catch (error) {
  parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}