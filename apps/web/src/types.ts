export interface User {
  id: string;
  username: string;
  /** `admin` thấy được khu vực quản trị; tài khoản thường không thấy gì. */
  role: 'user' | 'admin';
  /** Phiên khách: vào chơi bằng tên, không có mật khẩu, tự hết hạn. */
  isGuest?: boolean;
}

export interface LobbyMember {
  userId: string;
  username: string;
  symbol: string;
  isBot?: boolean;
}

export interface LobbyView {
  code: string;
  hostId: string;
  tier: string;
  winLength: number;
  premoveEnabled: boolean;
  cameraFollow: boolean;
  botDifficulty: 'easy' | 'normal' | 'hard';
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  members: LobbyMember[];
  /** Người thua ván trước — sẽ được đi trước ván tiếp theo. */
  nextFirstId?: string | null;
}

export interface BotStats {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  lessons: number;
  level: number;
  xp: number;
}

export interface LogEntry {
  id: number;
  at: number;
  level: 'info' | 'warn' | 'error' | 'bot';
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface TrainJob {
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
  error: string | null;
  result: {
    games: number;
    tier: string;
    level: string;
    results: { win: number; loss: number; draw: number };
    stats: BotStats;
    tookMs: number;
  } | null;
}

export interface AdminOverview {
  admin: { id: string; username: string; role: 'user' | 'admin' };
  bot: BotStats;
  logs: LogEntry[];
  training: TrainJob | null;
  system: {
    users: number;
    lobbies: number;
    matches: number;
    sessions: number;
    logLines: number;
    maxTrainGames: number;
    uptimeSec: number;
    nodeVersion: string;
  };
}

export interface AdminUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
  createdAt: number;
  isBot: boolean;
  display: string;
  games: number;
}

export interface TrainResponse {
  job: TrainJob;
  alreadyRunning: boolean;
}

export interface BoardCell {
  x: number;
  y: number;
  symbol: 'X' | 'O';
}

export interface Move {
  seq: number;
  playerId: string;
  symbol: 'X' | 'O';
  x: number;
  y: number;
  at: number;
  source: string;
}

export interface MatchPlayer {
  userId: string;
  username: string;
  symbol: 'X' | 'O';
  connected: boolean;
  premove: Cell[];
  stones: number;
}

export type ThemeName = 'dark' | 'midnight' | 'forest' | 'light';

export interface Cell {
  x: number;
  y: number;
}

export interface MatchState {
  matchId: string;
  code: string;
  rule: {
    tier: string;
    boardType: 'finite' | 'infinite';
    size: number;
    winLength: number;
    placement: 'free' | 'adjacent';
  };
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  players: MatchPlayer[];
  turn: string | null;
  board: BoardCell[];
  moves: Move[];
  seq: number;
  winnerId: string | null;
  winningLine: Cell[] | null;
  reason: string | null;
  premoveEnabled: boolean;
  cameraFollow: boolean;
  turnDeadline: number | null;
}

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  at: number;
}

export interface TierInfo {
  tier: string;
  label: string;
  description: string;
  defaultWinLength: number;
  minWinLength: number;
  maxWinLength: number;
  size: number;
  boardType: string;
}