import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import {
  adviceFor,
  analyzeMatch,
  assignSymbols,
  blockedPremoveCells,
  clearPremove,
  chooseBotMove,
  consumePremove,
  createBrain,
  createGame,
  endGame,
  getPremove,
  isDifficulty,
  isTier,
  learn,
  moderate,
  normalizeBrain,
  placeMove,
  resign,
  resolveRule,
  serializeState,
  setPremove,
  type BotBrain,
  type Cell,
  type GameState,
  type Symbol,
} from '@tt/engine';
import { botId, displayName, isBot, lobbyView, store, type ChatMessage } from './db.js';
import { logEvent } from './log.js';
import { userFromCookie } from './auth.js';
import {
  attachIo, chats, clearTimers, emitCountdown, emitLobby, emitMatch, emitMatchEnd,
  emitMatchMove, emitPremove, emitToRoom, emitTurn, games, isOnline, rateLimited, timers,
} from './hub.js';

const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS ?? 10_000);
const PREMOVE_LEAD_MS = Number(process.env.PREMOVE_LEAD_MS ?? 5_000);
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 30_000);
/** Bot nghĩ chậm hơn người để người chơi kịp nhìn thấy nước đi. */
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 700);
const REMATCH_REQUEST_MS = Number(process.env.REMATCH_REQUEST_MS ?? 30_000);
const BOT_REMATCH_COUNTDOWN_MS = Number(process.env.BOT_REMATCH_COUNTDOWN_MS ?? 3_000);
const pendingRematches = new Map<string, { requesterId: string; expiresAt: number; tier: 'classic' | 'big' | 'infinity' }>();

const MESSAGE_VI: Record<string, string> = {
  occupied: 'Ô này đã có quân rồi.',
  out_of_bounds: 'Ô này nằm ngoài bàn cờ.',
  invalid_coord: 'Toạ độ không hợp lệ.',
  NOT_YOUR_TURN: 'Chưa tới lượt bạn.',
  GAME_NOT_PLAYING: 'Ván đã kết thúc.',
  GAME_FINISHED: 'Ván đã kết thúc.',
  NOT_A_PLAYER: 'Bạn không thuộc ván này.',
  PREMOVE_FULL: 'Chỉ được xếp tối đa 3 nước trước.',
  PREMOVE_DUPLICATE: 'Không được xếp trùng ô.',
  PREMOVE_DISABLED: 'Chế độ đánh trước đang tắt.',
  PREMOVE_INVALID: 'Ô cờ không hợp lệ.',
};

const chatOf = (code: string): ChatMessage[] => {
  let list = chats.get(code);
  if (!list) { list = []; chats.set(code, list); }
  return list;
};

const persist = (game: GameState) =>
  store.matches.save({ id: game.matchId, lobbyCode: game.code, state: serializeState(game), createdAt: game.startedAt ?? Date.now() });

/** Não bot dùng chung cho mọi phòng — bot càng chơi càng tiến bộ. */
const BOT_BRAIN_ID = 'global';
let brainCache: BotBrain | null = null;

const brain = (): BotBrain => {
  if (!brainCache) brainCache = normalizeBrain(store.bots.get(BOT_BRAIN_ID)?.brain ?? null);
  return brainCache;
};

const saveBrain = (value: BotBrain) => {
  brainCache = value;
  store.bots.save(BOT_BRAIN_ID, value);
};

const beginCountdown = (code: string, duration = COUNTDOWN_MS) => {
  clearTimers(code);
  store.lobbies.update(code, { status: 'countdown' });
  emitLobby(code);
  emitCountdown(code, duration);
  timers.set(`countdown:${code}`, setTimeout(() => startMatch(code), duration));
};

/**
 * Sau mỗi ván có bot: rút kinh nghiệm từ ván đó.
 * - Bot thua → ghi nhớ nước sai của bot và nước đúng của người chơi thắng bot.
 * - Bot thắng → củng cố nước đánh của bot.
 * Kết quả cập nhật cả cấp độ (bot mạnh dần lên theo số ván).
 */
const trainFromMatch = (game: GameState) => {
  const botPlayer = game.players.find((p) => isBot(p.userId));
  if (!botPlayer) return;

  const opponent = game.players.find((p) => p.userId !== botPlayer.userId);
  if (!opponent) return;
  // Chỉ học từ ván người chơi thắng/thua bằng nước đi thật, bỏ qua khi bỏ cuộc/mất kết nối.
  if (game.reason !== 'win' && game.reason !== 'draw' && game.reason !== 'timeout') return;
  if (game.moves.length === 0) return;

  const botWon = game.winnerId ? game.winnerId === botPlayer.userId : null;
  const lessons = analyzeMatch({ moves: game.moves, rule: game.rule, botSymbol: botPlayer.symbol, botWon });
  if (lessons.length === 0 && botWon === null) return;

  const result = botWon === null ? 'draw' : botWon ? 'win' : 'loss';
  const updated = learn(brain(), lessons, result);
  saveBrain(updated);
  logEvent(
    'bot',
    'match',
    `Bot rut kinh nghiem sau van ${game.matchId}: ${result === 'win' ? 'thang' : result === 'loss' ? 'thua' : 'hoa'}, +${lessons.length} bai, cap do ${updated.stats.level}`,
    { code: game.code, result, lessons: lessons.length, level: updated.stats.level },
  );
};

/**
 * Bắt đầu ván mới. Người thua ván trước được đi trước ván này (nếu ván trước có người thua).
 */
const startMatch = (code: string) => {
  const lobby = store.lobbies.get(code);
  const players = store.members.list(code).map((m) => ({
    userId: m.userId,
    username: displayName(m.userId),
    symbol: m.symbol as Symbol,
  }));
  if (!lobby || players.length < 2) return;

  clearTimers(code);
  pendingRematches.delete(code);
  games.delete(code);

  // Người thua ván trước được đi trước; ván đầu tiên (hoặc ván trước bị hoà) thì chọn ngẫu nhiên.
  const ordered = assignSymbols(players, lobby.lastLoserId);

  const game = createGame({
    matchId: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    code,
    rule: resolveRule({ tier: lobby.tier as never, winLength: lobby.winLength }),
    players: ordered,
    premoveEnabled: lobby.premoveEnabled,
    cameraFollow: lobby.cameraFollow,
    startedAt: Date.now(),
  });
  games.set(code, game);
  store.lobbies.update(code, { status: 'playing' });
  logEvent('info', 'match', `Bat dau van ${game.matchId} tai phong ${code} (${game.rule.tier}, thang ${game.rule.winLength}), ${displayName(game.players[1]?.userId ?? '')} di truoc`, {
    code,
    tier: game.rule.tier,
    first: game.players[0]?.userId,
  });
  emitLobby(code);
  emitMatch(code);
  advance(code, game);
};

/** Bot tự đánh sau một khoảng trễ để người chơi kịp theo dõi. */
const playBotMove = (code: string, userId: string) => {
  const game = games.get(code);
  if (!game || game.status !== 'playing' || game.turn !== userId) return;
  const player = game.players.find((p) => p.userId === userId);
  if (!player) return;

  const lobby = store.lobbies.get(code);
  const difficulty = lobby?.botDifficulty ?? 'normal';
  const memory = brain();
  const lessonCount = memory.lessons.length;
  const cell = chooseBotMove(
    game.board,
    game.rule,
    player.symbol,
    difficulty,
    Math.random,
    { advice: adviceFor(memory, game.board, game.rule, player.symbol) },
    memory.stats.level,
  );
  if (!cell) {
    // Bàn không còn nước hợp lệ (bàn hữu hạn đầy) → kết thúc hoà
    games.set(code, endGame(game, null, 'draw'));
    emitMatch(code);
    advance(code, game);
    return;
  }

  const result = placeMove(game, { playerId: userId, x: cell.x, y: cell.y, at: Date.now(), source: 'play' });
  if (!result.ok) return;
  logEvent('bot', 'match', `Bot (${difficulty}, cap ${memory.stats.level}) danh (${cell.x},${cell.y}) tai phong ${code}${lessonCount ? ` — ap dung ${lessonCount} bai hoc da huan` : ''}`, {
    code,
    cell: { x: cell.x, y: cell.y },
  });
  games.set(code, result.state);
  emitMatchMove(code, { move: result.move, winningLine: result.winningLine, finished: result.finished });
  emitMatch(code);
  advance(code, result.state);
};

/** Sau mỗi nước đi: kết thúc ván nếu có, ngược lại hẹn giờ cho lượt kế tiếp (người hoặc bot). */
const advance = (code: string, game: GameState) => {
  persist(game);

  if (game.status === 'finished') {
    clearTimers(code);
    // Ghi nhớ người thua để họ được đi trước ván sau.
    if (game.winnerId) {
      const loser = game.players.find((p) => p.userId !== game.winnerId);
      if (loser) store.lobbies.update(code, { lastLoserId: loser.userId });
    }
    trainFromMatch(game);
    store.lobbies.update(code, { status: 'finished' });
    logEvent('info', 'match', `Ket thuc van tai phong ${code}: ${game.winnerId ? `${displayName(game.winnerId)} thang (${game.reason})` : `hoa (${game.reason})`}`, {
      code,
      winnerId: game.winnerId,
      reason: game.reason,
    });
    emitLobby(code);
    emitMatchEnd(code, { winnerId: game.winnerId, reason: game.reason, winningLine: game.winningLine });
    return;
  }
  const next = game.turn;
  if (!next) return;

  game.turnDeadline = Date.now() + PREMOVE_LEAD_MS;
  emitTurn(code, { userId: next, deadline: game.turnDeadline });

  if (isBot(next)) {
    timers.set(`turn:${code}`, setTimeout(() => playBotMove(code, next), BOT_DELAY_MS));
    return;
  }

  timers.set(`turn:${code}`, setTimeout(() => {
    const current = games.get(code);
    if (!current || current.status !== 'playing' || current.turn !== next) return;
    if (getPremove(current, next).length === 0) return;

    const consumed = consumePremove(current, next, Date.now());
    if (consumed.status === 'cancelled') {
      games.set(code, consumed.state);
      emitPremove(code, { userId: next, cells: [], blocked: [consumed.cell], cancelled: consumed.cell });
      emitMatch(code);
      advance(code, consumed.state);
      return;
    }
    if (consumed.status !== 'played' || !consumed.result.ok) return;

    const updated = consumed.result.state;
    games.set(code, updated);
    emitMatchMove(code, { move: consumed.result.move, winningLine: consumed.result.winningLine, finished: consumed.result.finished });
    emitMatch(code);
    advance(code, updated);
  }, PREMOVE_LEAD_MS));
};

export function attachSockets(http: HttpServer) {
  const io = new Server(http, { cors: { origin: true, credentials: true } });
  attachIo(io);

  io.use((socket, next) => {
    const user = userFromCookie(socket.request.headers.cookie);
    if (!user) return next(new Error('UNAUTHENTICATED'));
    socket.data.user = { id: user.id, username: user.username };
    return next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; username: string };
    const codeOf = () => socket.data.code as string | undefined;

    const leaveLobby = (code: string) => {
      const lobby = store.lobbies.get(code);
      if (!lobby) return;

      const game = games.get(code);
      if (game?.status === 'playing' && game.players.some((p) => p.userId === user.id)) {
        const ended = resign(game, user.id);
        games.set(code, ended);
        emitMatch(code);
        advance(code, ended);
      }

      store.members.remove(code, user.id);
      const remaining = store.members.list(code);
      if (lobby.hostId === user.id && remaining.length > 0) {
        const nextHost = remaining.find((m) => !isBot(m.userId));
        if (nextHost) store.lobbies.update(code, { hostId: nextHost.userId });
      }
      if (remaining.length === 0 || remaining.every((m) => isBot(m.userId))) {
        clearTimers(code);
        games.delete(code);
        pendingRematches.delete(code);
        store.lobbies.remove(code);
      } else {
        if (lobby.status === 'countdown' && remaining.length < 2) {
          clearTimers(code);
          store.lobbies.update(code, { status: 'waiting' });
        }
        emitLobby(code);
      }
      socket.leave(code);
      if (socket.data.code === code) socket.data.code = undefined;
    };

    socket.emit('hello', { user });

    socket.on('lobby:join', ({ code: raw }: { code?: string }) => {
      const code = String(raw ?? '').toUpperCase();
      if (!code) return;
      const previous = codeOf();
      if (previous && previous !== code) leaveLobby(previous);
      const lobby = store.lobbies.get(code);
      if (!lobby) return socket.emit('lobby:error', { code: 'LOBBY_NOT_FOUND', message: 'Không tìm thấy phòng với mã này.' });

      const members = store.members.list(code);
      const already = members.some((m) => m.userId === user.id);

      if (!already) {
        if (lobby.status !== 'waiting') {
          return socket.emit('lobby:error', { code: 'LOBBY_IN_PROGRESS', message: 'Ván đã bắt đầu, không thể vào phòng.' });
        }
        if (members.length >= 2) {
          return socket.emit('lobby:error', { code: 'LOBBY_FULL', message: 'Phòng đã đủ 2 người.' });
        }
        store.members.add(code, user.id, members.some((m) => m.symbol === 'X') ? 'O' : 'X');
      }

      socket.join(code);
      socket.data.code = code;
      emitLobby(code);
      socket.emit('lobby:state', lobbyView(code));
      socket.emit('chat:history', chatOf(code));
      if (games.has(code)) {
        socket.emit('match:state', serializeState(games.get(code)!));
        emitToRoom(code, 'lobby:presence', { userId: user.id, connected: true });
      }
    });

    socket.on('lobby:leave', () => {
      const code = codeOf();
      if (!code) return;
      leaveLobby(code);
    });

    socket.on('lobby:update', (payload: Record<string, unknown>) => {
      const code = codeOf();
      if (!code) return;
      const lobby = store.lobbies.get(code);
      if (!lobby || lobby.hostId !== user.id || lobby.status !== 'waiting') return;
      const tier = isTier(payload.tier) ? payload.tier : lobby.tier;
      const winLength = typeof payload.winLength === 'number'
        ? payload.winLength
        : tier === lobby.tier ? lobby.winLength : undefined;
      const rule = resolveRule({ tier: tier as never, winLength });
      const nextDifficulty = payload.botDifficulty;
      store.lobbies.update(code, {
        tier: rule.tier,
        winLength: rule.winLength,
        premoveEnabled: typeof payload.premoveEnabled === 'boolean' ? payload.premoveEnabled : lobby.premoveEnabled,
        cameraFollow: typeof payload.cameraFollow === 'boolean' ? payload.cameraFollow : lobby.cameraFollow,
        botDifficulty: isDifficulty(nextDifficulty) ? nextDifficulty : lobby.botDifficulty,
      });
      emitLobby(code);
    });

    socket.on('lobby:addBot', ({ difficulty }: { difficulty?: unknown } = {}) => {
      const code = codeOf();
      if (!code) return;
      const lobby = store.lobbies.get(code);
      if (!lobby || lobby.hostId !== user.id || lobby.status !== 'waiting') return;
      const members = store.members.list(code);
      if (members.some((m) => isBot(m.userId))) {
        if (isDifficulty(difficulty)) store.lobbies.update(code, { botDifficulty: difficulty });
        return emitLobby(code);
      }
      if (members.length >= 2) return socket.emit('lobby:error', { code: 'LOBBY_FULL', message: 'Phòng đã đủ người chơi.' });

      store.members.add(code, botId(code), 'O');
      if (isDifficulty(difficulty)) store.lobbies.update(code, { botDifficulty: difficulty });
      emitLobby(code);
    });

    socket.on('lobby:removeBot', () => {
      const code = codeOf();
      if (!code) return;
      const lobby = store.lobbies.get(code);
      if (!lobby || lobby.hostId !== user.id || lobby.status !== 'waiting') return;
      store.members.remove(code, botId(code));
      emitLobby(code);
    });

    socket.on('lobby:start', () => {
      const code = codeOf();
      if (!code) return;
      const lobby = store.lobbies.get(code);
      if (!lobby || lobby.hostId !== user.id) return socket.emit('lobby:error', { code: 'NOT_HOST', message: 'Chỉ chủ phòng mới được bắt đầu.' });
      if (lobby.status !== 'waiting') return socket.emit('lobby:error', { code: 'LOBBY_NOT_WAITING', message: 'Phòng không ở trạng thái chờ.' });
      if (store.members.list(code).length < 2) return socket.emit('lobby:error', { code: 'NEED_TWO_PLAYERS', message: 'Cần đủ 2 người mới bắt đầu được.' });

      beginCountdown(code);
    });

    socket.on('lobby:rematch:request', ({ tier: requestedTier }: { tier?: unknown } = {}) => {
      const code = codeOf();
      if (!code) return;
      const lobby = store.lobbies.get(code);
      const game = games.get(code);
      if (!lobby || store.members.list(code).length !== 2 || !game || game.status !== 'finished' || !game.players.some((p) => p.userId === user.id)) {
        return socket.emit('match:rematch-response', { accepted: false, message: 'Không thể gửi lời mời chơi lại lúc này.' });
      }
      const tier = isTier(requestedTier) ? requestedTier : lobby.tier as 'classic' | 'big' | 'infinity';
      const nextRule = resolveRule({ tier });
      if (isBot(game.players.find((p) => p.userId !== user.id)?.userId ?? '')) {
        pendingRematches.delete(code);
        store.lobbies.update(code, { tier: nextRule.tier, winLength: nextRule.winLength });
        beginCountdown(code, BOT_REMATCH_COUNTDOWN_MS);
        return;
      }
      if (pendingRematches.has(code)) return;
      const expiresAt = Date.now() + REMATCH_REQUEST_MS;
      pendingRematches.set(code, { requesterId: user.id, expiresAt, tier: nextRule.tier });
      emitToRoom(code, 'match:rematch-request', { requesterId: user.id, expiresAt, tier: nextRule.tier });
      timers.set(`rematch:${code}`, setTimeout(() => {
        const pending = pendingRematches.get(code);
        if (!pending || pending.requesterId !== user.id) return;
        pendingRematches.delete(code);
        emitToRoom(code, 'match:rematch-expired', {});
      }, REMATCH_REQUEST_MS));
    });

    socket.on('lobby:rematch:respond', ({ accept }: { accept?: boolean }) => {
      const code = codeOf();
      if (!code) return;
      const pending = pendingRematches.get(code);
      const game = games.get(code);
      if (!pending || !game || game.status !== 'finished' || pending.requesterId === user.id) return;
      if (!game.players.some((p) => p.userId === user.id)) return;
      clearTimeout(timers.get(`rematch:${code}`));
      timers.delete(`rematch:${code}`);
      pendingRematches.delete(code);
      if (accept) {
        const nextRule = resolveRule({ tier: pending.tier });
        store.lobbies.update(code, { tier: nextRule.tier, winLength: nextRule.winLength });
        emitToRoom(code, 'match:rematch-response', { accepted: true, responderId: user.id });
        beginCountdown(code);
      } else {
        emitToRoom(code, 'match:rematch-response', { accepted: false, responderId: user.id, requesterId: pending.requesterId, message: 'Đối thủ không muốn chơi lại.' });
      }
    });

    socket.on('lobby:kick', ({ userId }: { userId?: string }) => {
      const code = codeOf();
      if (!code || !userId) return;
      const lobby = store.lobbies.get(code);
      if (!lobby || lobby.hostId !== user.id || userId === user.id) return;
      store.members.remove(code, userId);
      for (const target of io.sockets.sockets.values()) {
        if (target.data.user?.id === userId) {
          target.emit('lobby:kicked');
          target.leave(code);
          target.data.code = undefined;
        }
      }
      emitLobby(code);
    });

    socket.on('game:place', (payload: Record<string, unknown>) => {
      const code = codeOf();
      if (!code || !rateLimited(socket.id, 20, 5_000)) return;
      const game = games.get(code);
      if (!game) return;

      const result = placeMove(game, { playerId: user.id, x: Number(payload.x), y: Number(payload.y), at: Date.now() });
      if (!result.ok) return socket.emit('match:error', { error: result.error, message: MESSAGE_VI[result.error] ?? 'Nước đi không hợp lệ.' });

      games.set(code, result.state);
      emitMatchMove(code, { move: result.move, winningLine: result.winningLine, finished: result.finished });
      emitMatch(code);
      advance(code, result.state);
    });

    socket.on('game:premove', (payload: { cells?: Cell[] }) => {
      const code = codeOf();
      if (!code || !rateLimited(socket.id, 10, 5_000)) return;
      const game = games.get(code);
      if (!game || !Array.isArray(payload.cells)) return;

      const clean = payload.cells.slice(0, 3).map((c) => ({ x: Math.trunc(Number(c?.x)), y: Math.trunc(Number(c?.y)) }));
      const result = setPremove(game, user.id, clean);
      if (!result.ok) return socket.emit('match:error', { error: result.error, message: MESSAGE_VI[result.error] ?? 'Không xếp được nước trước.' });

      games.set(code, result.state);
      const cells = result.state.players.find((p) => p.userId === user.id)?.premove ?? [];
      emitPremove(code, { userId: user.id, cells, blocked: blockedPremoveCells(result.state.board, result.state.rule, cells) });
      emitMatch(code);
    });

    socket.on('game:premove:clear', () => {
      const code = codeOf();
      const game = code ? games.get(code) : undefined;
      if (!code || !game) return;
      games.set(code, clearPremove(game, user.id));
      emitPremove(code, { userId: user.id, cells: [], blocked: [] });
      emitMatch(code);
    });

    socket.on('game:resign', () => {
      const code = codeOf();
      const game = code ? games.get(code) : undefined;
      if (!code || !game || game.status !== 'playing') return;
      const updated = resign(game, user.id);
      games.set(code, updated);
      emitMatch(code);
      advance(code, updated);
    });

    socket.on('chat:send', ({ text }: { text?: unknown }) => {
      const code = codeOf();
      if (!code || typeof text !== 'string' || !rateLimited(socket.id, 5, 5_000)) return;

      const cleaned = moderate(text.trim().slice(0, 300));

      // Bị chặn hẳn: KHÔNG gửi vào phòng, chỉ báo người gửi.
      if (cleaned.blocked) {
        socket.emit('chat:rejected', { reason: cleaned.reason });
        return;
      }

      const message: ChatMessage = {
        userId: user.id,
        username: user.username,
        text: cleaned.text,
        at: Date.now(),
      };
      const list = chatOf(code);
      list.push(message);
      if (list.length > 100) list.shift();
      emitToRoom(code, 'chat:message', message);
      if (cleaned.hits > 0) socket.emit('chat:moderated', { reason: cleaned.reason });
    });

    socket.on('disconnect', () => {
      const code = codeOf();
      if (!code) return;
      const game = games.get(code);
      if (!game || game.status !== 'playing') return;

      emitToRoom(code, 'lobby:presence', { userId: user.id, connected: false });
      timers.set(`disconnect:${code}`, setTimeout(() => {
        if (isOnline(code, user.id)) return;
        const live = games.get(code);
        if (!live || live.status !== 'playing') return;
        const opponent = live.players.find((p) => p.userId !== user.id);
        const updated = endGame(live, opponent?.userId ?? null, 'disconnect');
        games.set(code, updated);
        emitMatch(code);
        advance(code, updated);
      }, RECONNECT_GRACE_MS));
    });
  });

  return io;
}
