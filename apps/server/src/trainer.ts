/**
 * Runner huấn luyện bot: cho bot tự đấu chính nó rồi tự rút kinh nghiệm.
 *
 * - `trainBrain()`: hàm thuần, chạy trong worker (không chặn server).
 * - `startTrainingJob()`: bật nền qua worker thread, có báo tiến độ để admin theo dõi.
 * - `runTraining()`: chạy đồng bộ (dùng cho CLI `npm run train` và test).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  chooseBotMoveWithProfile,
  createBrain,
  isDifficulty,
  isTier,
  normalizeBrain,
  profileFor,
  resolveRule,
  selfTrain,
  type BoardRule,
  type BotBrain,
  type BrainStats,
  type Cell,
  type Difficulty,
  type Symbol,
  type Tier,
} from '@tt/engine';
import { store } from './db.js';
import { logEvent } from './log.js';

const BOT_BRAIN_ID = 'global';

export interface TrainOptions {
  games?: number;
  tier?: string;
  level?: string;
  seed?: number;
  /** Độ mạnh đối thủ tự đấu: `hard` (mặc định, học được nhiều nhất) hoặc `easy`. */
  opponent?: string;
}

export interface TrainResult {
  games: number;
  tier: string;
  level: string;
  results: { win: number; loss: number; draw: number };
  stats: BrainStats;
  tookMs: number;
}

export interface TrainingJob {
  id: string;
  running: boolean;
  done: number;
  total: number;
  tier: string;
  level: string;
  opponent: string;
  startedBy: string;
  startedAt: number;
  finishedAt: number | null;
  result: TrainResult | null;
  error: string | null;
}

export const MAX_TRAIN_GAMES = 2000;

const brainCache = { value: null as BotBrain | null };

export function loadBrain(): BotBrain {
  if (!brainCache.value) brainCache.value = normalizeBrain(store.bots.get(BOT_BRAIN_ID)?.brain ?? null);
  return brainCache.value;
}

export function saveBrain(brain: BotBrain): void {
  brainCache.value = brain;
  store.bots.save(BOT_BRAIN_ID, brain);
}

export function resetBrain(): BotBrain {
  const fresh = createBrain();
  saveBrain(fresh);
  return fresh;
}

export interface NormalizedTrain {
  games: number;
  tier: Tier;
  level: Difficulty;
  opponent: Difficulty;
  seed: number;
}

export function normalizeOptions(options: TrainOptions = {}): NormalizedTrain {
  return {
    games: Math.max(1, Math.min(MAX_TRAIN_GAMES, Math.floor(options.games ?? 100))),
    tier: isTier(options.tier) ? options.tier : 'classic',
    level: isDifficulty(options.level) ? options.level : 'hard',
    opponent: isDifficulty(options.opponent) ? options.opponent : 'easy',
    seed: Math.floor(options.seed ?? (Date.now() % 100000)),
  };
}

/**
 * Huấn luyện trên một bộ não cho trước — hàm thuần, không đụng tới database.
 * Một nửa ván dùng cấu hình mạnh, một nửa yếu hơn, để bot học được cả cách chơi tốt lẫn lối.
 */
export function trainBrain(
  brain: BotBrain,
  options: TrainOptions = {},
  onGame?: (done: number, total: number) => void,
): { result: TrainResult; brain: BotBrain } {
  const opts = normalizeOptions(options);
  const rule: BoardRule = resolveRule({ tier: opts.tier });
  const rng = (() => {
    let state = opts.seed | 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const startedAt = Date.now();

  const play = (
    board: Record<string, Symbol>,
    currentRule: BoardRule,
    symbol: Symbol,
    brainLevel: number,
  ): Cell | null => {
    const useWeak = rng() < 0.5;
    const profile = profileFor(useWeak ? opts.opponent : opts.level, brainLevel);
    return chooseBotMoveWithProfile(board, currentRule, symbol, profile, rng, {}, false);
  };

  const trained = selfTrain(brain.lessons.length ? brain : createBrain(), rule, opts.games, play, Date.now() - opts.games * 1000, onGame);

  return {
    brain: trained.brain,
    result: {
      games: opts.games,
      tier: opts.tier,
      level: opts.level,
      results: trained.results,
      stats: trained.brain.stats,
      tookMs: Date.now() - startedAt,
    },
  };
}

/** Chạy đồng bộ (CLI / test) — chặn tiến trình cho tới khi xong. */
export function runTraining(options: TrainOptions = {}): TrainResult {
  const { result, brain } = trainBrain(loadBrain(), options);
  saveBrain(brain);
  return result;
}

/**
 * Dự phòng khi không dùng được worker: chia ván thành nhiều lô, giữa mỗi lô nhường
 * event loop (`setImmediate`) nên server vẫn phản hồi được trong lúc train.
 */
async function trainInChunks(
  brain: BotBrain,
  opts: NormalizedTrain,
  onProgress: (done: number, total: number) => void,
): Promise<{ brain: BotBrain; result: TrainResult }> {
  const startedAt = Date.now();
  const batchSize = Math.max(1, Math.min(25, Math.ceil(opts.games / 20)));
  const totals = { win: 0, loss: 0, draw: 0 };
  let current = brain;
  let done = 0;

  while (done < opts.games) {
    const size = Math.min(batchSize, opts.games - done);
    const step = trainBrain(current, { ...opts, games: size, seed: opts.seed + done });
    current = step.brain;
    totals.win += step.result.results.win;
    totals.loss += step.result.results.loss;
    totals.draw += step.result.results.draw;
    done += size;
    onProgress(done, opts.games);
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    brain: current,
    result: {
      games: opts.games,
      tier: opts.tier,
      level: opts.level,
      results: totals,
      stats: current.stats,
      tookMs: Date.now() - startedAt,
    },
  };
}

/** Worker chỉ tồn tại sau khi build (dist/train-worker.js); khi chạy bằng tsx/vitest thì dùng lô. */
function workerAvailable(): boolean {
  try {
    return existsSync(fileURLToPath(new URL('./train-worker.js', import.meta.url)));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Job nền chạy trong worker thread                                   */
/* ------------------------------------------------------------------ */

let currentJob: TrainingJob | null = null;
let currentWorker: Worker | null = null;
let cancelFlag = false;

class TrainCancelled extends Error {
  constructor() {
    super('đã huỷ thủ công');
    this.name = 'TrainCancelled';
  }
}

export function trainingJob(): TrainingJob | null {
  return currentJob;
}

export function isTraining(): boolean {
  return currentJob?.running === true;
}

/** Bật train nền. Trả về job đang chạy; nếu đang chạy thì trả về job cũ (không chạy trùng). */
export function startTrainingJob(options: TrainOptions = {}, startedBy = 'admin'): TrainingJob {
  if (currentJob?.running) return currentJob;

  const opts = normalizeOptions(options);
  const job: TrainingJob = {
    id: `job_${Date.now().toString(36)}`,
    running: true,
    done: 0,
    total: opts.games,
    tier: opts.tier,
    level: opts.level,
    opponent: opts.opponent,
    startedBy,
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  currentJob = job;
  cancelFlag = false;

  const finish = (result: TrainResult, brain: BotBrain) => {
    saveBrain(brain);
    job.result = result;
    job.done = job.total;
    job.running = false;
    job.finishedAt = Date.now();
    logEvent(
      'bot',
      'admin',
      `Train xong ${result.games} van (${result.tier}): cap do ${result.stats.level}, ${result.stats.lessons} bai hoc, ${(result.tookMs / 1000).toFixed(1)}s`,
      { tookMs: result.tookMs, results: result.results },
    );
  };

  const fail = (message: string) => {
    job.running = false;
    job.error = message;
    job.finishedAt = Date.now();
    logEvent('error', 'admin', `Train that bai: ${message}`);
  };

  // Không có worker (chạy bằng tsx/vitest) → chia lô, vẫn nhường event loop.
  if (!workerAvailable()) {
    logEvent('bot', 'admin', 'Worker khong kha dung — chay theo lot tren luong chinh');
    void trainInChunks(loadBrain(), opts, (done, total) => {
      job.done = done;
      job.total = total;
      if (cancelFlag) throw new TrainCancelled();
    })
      .then(({ result, brain }) => finish(result, brain))
      .catch((error: unknown) => {
        if (error instanceof TrainCancelled) {
          job.running = false;
          job.error = 'đã huỷ thủ công';
          job.finishedAt = Date.now();
          logEvent('warn', 'admin', 'Admin huy job train');
          return;
        }
        fail(error instanceof Error ? error.message : String(error));
      });
    return job;
  }

  const worker = new Worker(new URL('./train-worker.js', import.meta.url), {
    workerData: { brain: loadBrain(), games: opts.games, tier: opts.tier, level: opts.level, opponent: opts.opponent, seed: opts.seed },
  });
  currentWorker = worker;

  worker.on('message', (message: { type: string; done?: number; total?: number; brain?: BotBrain; results?: { win: number; loss: number; draw: number }; stats?: BrainStats; tookMs?: number; message?: string }) => {
    if (message.type === 'progress') {
      job.done = message.done ?? job.done;
      if (message.total) job.total = message.total;
      return;
    }
    if (message.type === 'done' && message.brain && message.stats) {
      finish(
        {
          games: opts.games,
          tier: opts.tier,
          level: opts.level,
          results: message.results ?? { win: 0, loss: 0, draw: 0 },
          stats: message.stats,
          tookMs: message.tookMs ?? 0,
        },
        message.brain,
      );
    } else if (message.type === 'error') {
      fail(message.message ?? 'loi khong ro');
    }
    void worker.terminate();
    if (currentWorker === worker) currentWorker = null;
  });

  worker.on('error', (error) => {
    fail(error.message);
    if (currentWorker === worker) currentWorker = null;
  });

  return job;
}

export function cancelTrainingJob(): boolean {
  if (!currentJob?.running) return false;
  cancelFlag = true;
  if (currentWorker) {
    void currentWorker.terminate();
    currentWorker = null;
  }
  currentJob.running = false;
  currentJob.error = 'đã huỷ thủ công';
  currentJob.finishedAt = Date.now();
  logEvent('warn', 'admin', 'Admin huy job train');
  return true;
}