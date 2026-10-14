export type Symbol = 'X' | 'O';

export type Tier = 'classic' | 'big' | 'infinity';

export interface Cell {
  x: number;
  y: number;
}

export interface BoardRule {
  tier: Tier;
  boardType: 'finite' | 'infinite';
  /** Kích thước bàn hữu hạn. Với bàn vô hạn luôn bằng 0. */
  size: number;
  /** Số quân liền kề (không có ô rỗng xen giữa) để thắng. */
  winLength: number;
  placement: 'free' | 'adjacent';
}

export type PlacementError =
  | 'occupied'
  | 'out_of_bounds'
  | 'invalid_coord';

export interface PlacementResult {
  ok: boolean;
  error?: PlacementError;
}

export type MoveSource = 'play' | 'premove' | 'auto' | 'resign' | 'timeout' | 'disconnect';

export interface Move {
  seq: number;
  playerId: string;
  symbol: Symbol;
  x: number;
  y: number;
  at: number;
  source: MoveSource;
}

export type GameStatus = 'waiting' | 'countdown' | 'playing' | 'finished';
export type EndReason = 'win' | 'draw' | 'resign' | 'disconnect' | 'timeout';

export interface PlayerState {
  userId: string;
  username: string;
  symbol: Symbol;
  connected: boolean;
  premove: Cell[];
  stones: number;
  finished: boolean;
}

export interface GameState {
  matchId: string;
  code: string;
  rule: BoardRule;
  status: GameStatus;
  players: PlayerState[];
  turn: string | null;
  board: Record<string, Symbol>;
  moves: Move[];
  seq: number;
  winnerId: string | null;
  winningLine: Cell[] | null;
  reason: EndReason | null;
  premoveEnabled: boolean;
  cameraFollow: boolean;
  startedAt: number | null;
  turnDeadline: number | null;
}

export type MoveError =
  | 'GAME_NOT_PLAYING'
  | 'NOT_YOUR_TURN'
  | 'NOT_A_PLAYER'
  | 'GAME_FINISHED'
  | 'PREMOVE_DISABLED'
  | 'PREMOVE_FULL'
  | 'PREMOVE_DUPLICATE'
  | PlacementError;

export type PlaceResult =
  | { ok: true; state: GameState; move: Move; winningLine: Cell[] | null; finished: boolean }
  | { ok: false; error: MoveError };

export const MAX_PREMOVE = 3;

export const cellKey = (x: number, y: number): string => `${x},${y}`;

export const otherSymbol = (s: Symbol): Symbol => (s === 'X' ? 'O' : 'X');
