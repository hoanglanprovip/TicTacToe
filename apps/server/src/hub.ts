import type { Server as SocketIOServer } from 'socket.io';
import { serializeState, type GameState } from '@tt/engine';
import { lobbyView, store, type ChatMessage } from './db.js';

/** Trạng thái ván đang chơi giữ trong RAM. DB chỉ dùng để thống kê ván đã kết thúc. */
export const games = new Map<string, GameState>();
export const chats = new Map<string, ChatMessage[]>();
export const timers = new Map<string, NodeJS.Timeout>();

let io: SocketIOServer | null = null;
export const attachIo = (server: SocketIOServer) => { io = server; };

export const getLiveLobby = (code: string) => lobbyView(code);
export const getChatHistory = (code: string): ChatMessage[] => chats.get(code) ?? [];

export function clearTimers(code: string) {
  for (const key of [`countdown:${code}`, `turn:${code}`, `disconnect:${code}`, `rematch:${code}`]) {
    const timer = timers.get(key);
    if (timer) { clearTimeout(timer); timers.delete(key); }
  }
}

export const emitLobby = (code: string) => io?.to(code).emit('lobby:state', lobbyView(code));

export const emitMatch = (code: string) => {
  const game = games.get(code);
  if (game) io?.to(code).emit('match:state', serializeState(game));
};

export const emitMatchMove = (code: string, payload: unknown) => io?.to(code).emit('match:move', payload);
export const emitMatchEnd = (code: string, payload: unknown) => io?.to(code).emit('match:end', payload);
export const emitCountdown = (code: string, ms: number) =>
  io?.to(code).emit('match:countdown', { ms, endsAt: Date.now() + ms });
export const emitTurn = (code: string, payload: unknown) => io?.to(code).emit('match:turn', payload);
export const emitPremove = (code: string, payload: unknown) => io?.to(code).emit('match:premove', payload);
export const emitToRoom = (code: string, event: string, payload: unknown) => io?.to(code).emit(event, payload);

export function broadcastRooms(code: string) {
  emitLobby(code);
  emitMatch(code);
}

const rateBuckets = new Map<string, { count: number; reset: number }>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || entry.reset <= now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

export const isOnline = (code: string, userId: string): boolean =>
  [...(io?.sockets.sockets.values() ?? [])].some((s) => s.data.code === code && s.data.user?.id === userId);
