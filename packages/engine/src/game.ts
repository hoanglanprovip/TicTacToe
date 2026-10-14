import {
  findWinningLine,
  isBoardFull,
  setStone,
  validatePlacement,
  nearestLegalCell,
} from './board.js';
import {
  MAX_PREMOVE,
  cellKey,
  type BoardRule,
  type Cell,
  type EndReason,
  type GameState,
  type Move,
  type MoveError,
  type MoveSource,
  type PlaceResult,
  type PlayerState,
  type Symbol,
} from './types.js';

export interface CreateGameInput {
  matchId: string;
  code: string;
  rule: BoardRule;
  players: Array<{ userId: string; username: string; symbol: Symbol; connected?: boolean }>;
  premoveEnabled?: boolean;
  cameraFollow?: boolean;
  startedAt?: number;
}

/** Randomly decide who gets X / the first turn for each new match. */
export function assignRandomSymbols<T extends { userId: string }>(
  players: T[],
  rng: () => number = Math.random,
): Array<T & { symbol: Symbol }> {
  return assignSymbols(players, null, rng);
}

/**
 * Gán X/O cho ván mới.
 * - Nếu có `firstUserId` (thường là người thua ván trước) thì người đó được đi trước (đi X).
 * - Ván đầu tiên hoặc ván trước bị hoà: chọn ngẫu nhiên như cũ.
 */
export function assignSymbols<T extends { userId: string }>(
  players: T[],
  firstUserId: string | null | undefined,
  rng: () => number = Math.random,
): Array<T & { symbol: Symbol }> {
  if (players.length !== 2) throw new Error('A match requires exactly two players.');

  const ordered =
    firstUserId && players.some((p) => p.userId === firstUserId)
      ? [...players].sort((a, b) => (a.userId === firstUserId ? -1 : b.userId === firstUserId ? 1 : 0))
      : rng() < 0.5
      ? [...players]
      : [...players].reverse();

  return ordered.map((player, index) => ({ ...player, symbol: index === 0 ? 'X' : 'O' }));
}

/** Người thua ván vừa rồi (dùng để cho họ đi trước ván sau). Hoà thì giữ nguyên. */
export function loserOf(state: Pick<GameState, 'winnerId' | 'players'>, previousFirstId?: string | null): string | null {
  const { winnerId, players } = state;
  if (!winnerId) return previousFirstId ?? null;
  const loser = players.find((p) => p.userId !== winnerId);
  return loser ? loser.userId : null;
}

export function createGame(input: CreateGameInput): GameState {
  const players: PlayerState[] = input.players.map((p) => ({
    userId: p.userId,
    username: p.username,
    symbol: p.symbol,
    connected: p.connected ?? true,
    premove: [],
    stones: 0,
    finished: false,
  }));
  const first = players[0];
  return {
    matchId: input.matchId,
    code: input.code,
    rule: input.rule,
    status: 'playing',
    players,
    turn: first ? first.userId : null,
    board: {},
    moves: [],
    seq: 0,
    winnerId: null,
    winningLine: null,
    reason: null,
    premoveEnabled: input.premoveEnabled ?? true,
    cameraFollow: input.cameraFollow ?? true,
    startedAt: input.startedAt ?? null,
    turnDeadline: null,
  };
}

export const cloneState = (state: GameState): GameState => ({
  ...state,
  rule: { ...state.rule },
  players: state.players.map((p) => ({ ...p, premove: p.premove.map((c) => ({ ...c })) })),
  board: { ...state.board },
  moves: state.moves.map((m) => ({ ...m })),
  winningLine: state.winningLine ? state.winningLine.map((c) => ({ ...c })) : null,
});

export const findPlayer = (state: GameState, userId: string): PlayerState | undefined =>
  state.players.find((p) => p.userId === userId);

export const nextPlayer = (state: GameState, afterUserId: string): PlayerState | undefined => {
  const i = state.players.findIndex((p) => p.userId === afterUserId);
  if (i === -1) return undefined;
  return state.players[(i + 1) % state.players.length];
};

const fail = (error: MoveError): PlaceResult => ({ ok: false, error });

/**
 * Đánh một quân. Hàm thuần: trả về state mới, không mutate input.
 * Kiểm tra đầy đủ luật — đây là nguồn sự thật, client KHÔNG được tin.
 */
export function placeMove(
  state: GameState,
  params: { playerId: string; x: number; y: number; at: number; source?: MoveSource },
): PlaceResult {
  if (state.status !== 'playing') return fail('GAME_NOT_PLAYING');

  const player = findPlayer(state, params.playerId);
  if (!player) return fail('NOT_A_PLAYER');
  if (state.turn !== player.userId) return fail('NOT_YOUR_TURN');

  const placement = validatePlacement(state.board, state.rule, params.x, params.y);
  if (!placement.ok) return fail(placement.error ?? 'invalid_coord');

  const seq = state.seq + 1;
  const move: Move = {
    seq,
    playerId: player.userId,
    symbol: player.symbol,
    x: params.x,
    y: params.y,
    at: params.at,
    source: params.source ?? 'play',
  };

  const board = setStone(state.board, params.x, params.y, player.symbol);
  const winningLine = findWinningLine(board, state.rule, player.symbol, params.x, params.y);

  const next: GameState = {
    ...state,
    board,
    moves: [...state.moves, move],
    seq,
    players: state.players.map((p) =>
      p.userId === player.userId
        ? { ...p, stones: p.stones + 1, premove: params.source === 'premove' ? p.premove.slice(1) : [] }
        : p,
    ),
    turn: null,
    winningLine,
  };

  if (winningLine) {
    next.status = 'finished';
    next.winnerId = player.userId;
    next.reason = 'win';
    next.turnDeadline = null;
    return { ok: true, state: next, move, winningLine, finished: true };
  }

  if (isBoardFull(board, state.rule)) {
    next.status = 'finished';
    next.winnerId = null;
    next.reason = 'draw';
    next.turnDeadline = null;
    return { ok: true, state: next, move, winningLine: null, finished: true };
  }

  const upcoming = nextPlayer(next, player.userId);
  next.turn = upcoming ? upcoming.userId : null;
  return { ok: true, state: next, move, winningLine: null, finished: false };
}

/** Đặt nước trước. Không kiểm tra hợp lệ với bàn hiện tại — đối thủ có thể chặn sau đó. */
export function setPremove(
  state: GameState,
  userId: string,
  cells: Cell[],
): { ok: true; state: GameState } | { ok: false; error: MoveError } {
  if (!state.premoveEnabled) return { ok: false, error: 'PREMOVE_DISABLED' };
  const player = findPlayer(state, userId);
  if (!player) return { ok: false, error: 'NOT_A_PLAYER' };
  if (state.status !== 'playing') return { ok: false, error: 'GAME_NOT_PLAYING' };
  if (cells.length > MAX_PREMOVE) return { ok: false, error: 'PREMOVE_FULL' };

  const seen = new Set<string>();
  for (const c of cells) {
    if (!Number.isSafeInteger(c.x) || !Number.isSafeInteger(c.y)) return { ok: false, error: 'invalid_coord' };
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) return { ok: false, error: 'PREMOVE_DUPLICATE' };
    seen.add(k);
  }

  return {
    ok: true,
    state: {
      ...state,
      players: state.players.map((p) =>
        p.userId === userId ? { ...p, premove: cells.map((c) => ({ x: c.x, y: c.y })) } : p,
      ),
    },
  };
}

export function clearPremove(state: GameState, userId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.userId === userId ? { ...p, premove: [] } : p)),
  };
}

export function getPremove(state: GameState, userId: string): Cell[] {
  return findPlayer(state, userId)?.premove ?? [];
}

/**
 * Đến lượt: tự động đánh nước đầu tiên trong hàng đợi pre-move.
 * Nếu ô đó không còn hợp lệ (đối thủ vừa chiếm) → trả về 'cancelled' để server
 * báo người chơi, KHÔNG tự dời quân.
 */
export function consumePremove(
  state: GameState,
  userId: string,
  at: number,
): { status: 'none' } | { status: 'played'; result: PlaceResult } | { status: 'cancelled'; cell: Cell; state: GameState } {
  const queued = getPremove(state, userId);
  if (!state.premoveEnabled || queued.length === 0 || state.turn !== userId) return { status: 'none' };

  const head = queued[0]!;
  if (!validatePlacement(state.board, state.rule, head.x, head.y).ok) {
    return {
      status: 'cancelled',
      cell: head,
      state: { ...state, players: state.players.map((p) => (p.userId === userId ? { ...p, premove: [] } : p)) },
    };
  }

  const result = placeMove(state, { playerId: userId, x: head.x, y: head.y, at, source: 'premove' });
  return { status: 'played', result };
}

/** Tuỳ chọn autoRelocate: nếu nước đi trước bị chặn, đánh hộ ô hợp lệ gần nhất. */
export function autoRelocateMove(
  state: GameState,
  userId: string,
  target: Cell,
  at: number,
): PlaceResult | null {
  const alt = nearestLegalCell(state.board, state.rule, target.x, target.y);
  if (!alt) return null;
  return placeMove(state, { playerId: userId, x: alt.x, y: alt.y, at, source: 'auto' });
}

export function endGame(
  state: GameState,
  winnerId: string | null,
  reason: EndReason,
): GameState {
  return {
    ...state,
    status: 'finished',
    winnerId,
    reason,
    turn: null,
    turnDeadline: null,
  };
}

export function resign(state: GameState, userId: string): GameState {
  const player = findPlayer(state, userId);
  if (!player) return state;
  const opponent = state.players.find((p) => p.userId !== userId);
  return endGame(state, opponent ? opponent.userId : null, 'resign');
}

/** Kết quả tính điểm khi ván vô hạn không thể hoà và buộc phải kết thúc. */
export function scoreResult(state: GameState, winnerId: string | null, reason: EndReason): GameState {
  return endGame(state, winnerId, reason);
}

export function serializeState(state: GameState) {
  return {
    matchId: state.matchId,
    code: state.code,
    rule: state.rule,
    status: state.status,
    players: state.players,
    turn: state.turn,
    board: Object.entries(state.board).map(([k, symbol]) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return { x, y, symbol };
    }),
    moves: state.moves,
    seq: state.seq,
    winnerId: state.winnerId,
    winningLine: state.winningLine,
    reason: state.reason,
    premoveEnabled: state.premoveEnabled,
    cameraFollow: state.cameraFollow,
    startedAt: state.startedAt,
    turnDeadline: state.turnDeadline,
  };
}
