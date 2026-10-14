import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type UserRole = 'user' | 'admin';

export interface UserRecord {
  id: string;
  username: string;
  passHash: string;
  passSalt: string;
  createdAt: number;
  /** `admin` thấy được khu vực quản trị (log, não bot, danh sách tài khoản). */
  role: UserRole;
}

export interface SessionRecord {
  jti: string;
  userId: string;
  expiresAt: number;
}

/** Người chơi tạm (không cần tài khoản), tự xoá sau khi hết hạn. */
export interface GuestRecord {
  id: string;
  username: string;
  createdAt: number;
  lastSeen: number;
}

export type LobbyStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface LobbyRecord {
  code: string;
  hostId: string;
  tier: string;
  winLength: number;
  premoveEnabled: boolean;
  cameraFollow: boolean;
  botDifficulty: 'easy' | 'normal' | 'hard';
  status: LobbyStatus;
  createdAt: number;
  expiresAt: number;
  /** Người thua ván trước — được quyền đi trước ván sau. */
  lastLoserId: string | null;
}

export interface MemberRecord {
  code: string;
  userId: string;
  symbol: 'X' | 'O';
  joinedAt: number;
  seq: number;
}

export interface MatchRecord {
  id: string;
  lobbyCode: string;
  state: unknown;
  createdAt: number;
}

/** Não bot: bài học + thống kê, dùng để bot tự tiến bộ sau mỗi ván. */
export interface BotBrainRecord {
  id: string;
  brain: unknown;
  updatedAt: number;
}

interface Data {
  version: 1;
  users: UserRecord[];
  sessions: SessionRecord[];
  lobbies: LobbyRecord[];
  members: MemberRecord[];
  matches: MatchRecord[];
  bots: BotBrainRecord[];
  guests: GuestRecord[];
}

const empty = (): Data => ({
  version: 1,
  users: [],
  sessions: [],
  lobbies: [],
  members: [],
  matches: [],
  bots: [],
  guests: [],
});

const file = resolve(process.env.DB_PATH ?? 'data/game.json');
let data: Data = empty();
let seq = 0;

function load() {
  try {
    if (existsSync(file)) data = { ...empty(), ...(JSON.parse(readFileSync(file, 'utf8')) as Data) };
  } catch {
    data = empty();
  }
  seq = data.members.reduce((max, m) => Math.max(max, m.seq), 0);
}

function flush() {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), 'utf8');
    renameSync(tmp, file);
  } catch {
    /* không ghi được file vẫn chơi được, chỉ mất dữ liệu khi restart */
  }
}

load();

export const store = {
  path: file,

  health: () => true,

  users: {
    create(user: UserRecord) {
      data.users.push(user);
      flush();
      return user;
    },
    get(id: string) {
      return data.users.find((u) => u.id === id);
    },
    findByUsername(username: string) {
      const key = username.trim().toLowerCase();
      return data.users.find((u) => u.username.toLowerCase() === key);
    },
    list() {
      return data.users;
    },
    setPassword(id: string, passHash: string, passSalt: string) {
      const user = data.users.find((u) => u.id === id);
      if (!user) return undefined;
      user.passHash = passHash;
      user.passSalt = passSalt;
      flush();
      return user;
    },
    setRole(id: string, role: UserRole) {
      const user = data.users.find((u) => u.id === id);
      if (!user) return undefined;
      user.role = role;
      flush();
      return user;
    },
  },

  sessions: {
    create(session: SessionRecord) {
      data.sessions.push(session);
      flush();
    },
    get(jti: string) {
      return data.sessions.find((s) => s.jti === jti && s.expiresAt > Date.now());
    },
    list() {
      return data.sessions;
    },
    remove(jti: string) {
      data.sessions = data.sessions.filter((s) => s.jti !== jti);
      flush();
    },
    removeByUser(userId: string) {
      data.sessions = data.sessions.filter((s) => s.userId !== userId);
      flush();
    },
  },

  guests: {
    create(guest: GuestRecord) {
      data.guests.push(guest);
      flush();
      return guest;
    },
    get(id: string) {
      return data.guests.find((g) => g.id === id);
    },
    list() {
      return data.guests;
    },
    /** Cập nhật hoạt động (chỉ trong RAM, không ghi đè file mỗi lần click). */
    touch(id: string) {
      const guest = data.guests.find((g) => g.id === id);
      if (guest) guest.lastSeen = Date.now();
    },
    /** Dọn khách cũ + giới hạn số khách đang hoạt động. */
    prune(maxAgeMs: number, maxActive: number) {
      const now = Date.now();
      const active = data.guests.filter((g) => now - g.lastSeen <= maxAgeMs).sort((a, b) => b.lastSeen - a.lastSeen);
      const keep = active.slice(0, maxActive);
      const keepIds = new Set(keep.map((g) => g.id));
      const removed = data.guests.length - keepIds.size;
      data.guests = data.guests.filter((g) => keepIds.has(g.id));
      if (removed > 0) flush();
      return data.guests.length;
    },
  },

  lobbies: {
    create(lobby: LobbyRecord) {
      data.lobbies.push(lobby);
      flush();
      return lobby;
    },
    get(code: string) {
      return data.lobbies.find((l) => l.code === code);
    },
    list() {
      return data.lobbies;
    },
    update(code: string, patch: Partial<LobbyRecord>) {
      const lobby = data.lobbies.find((l) => l.code === code);
      if (!lobby) return undefined;
      Object.assign(lobby, patch);
      flush();
      return lobby;
    },
    remove(code: string) {
      data.lobbies = data.lobbies.filter((l) => l.code !== code);
      flush();
    },
  },

  members: {
    add(code: string, userId: string, symbol: 'X' | 'O') {
      const existing = data.members.find((m) => m.code === code && m.userId === userId);
      if (existing) return existing;
      const member: MemberRecord = { code, userId, symbol, joinedAt: Date.now(), seq: ++seq };
      data.members.push(member);
      flush();
      return member;
    },
    remove(code: string, userId: string) {
      data.members = data.members.filter((m) => !(m.code === code && m.userId === userId));
      flush();
    },
    list(code: string) {
      return data.members.filter((m) => m.code === code).sort((a, b) => a.seq - b.seq);
    },
  },

  matches: {
    save(record: MatchRecord) {
      data.matches = data.matches.filter((m) => m.id !== record.id);
      data.matches.push(record);
      flush();
    },
    list() {
      return data.matches;
    },
  },

  bots: {
    get(id: string) {
      return data.bots.find((b) => b.id === id);
    },
    save(id: string, brain: unknown) {
      const existing = data.bots.find((b) => b.id === id);
      const record: BotBrainRecord = { id, brain, updatedAt: Date.now() };
      if (existing) Object.assign(existing, record);
      else data.bots.push(record);
      flush();
      return record;
    },
  },
};

export interface User { id: string; username: string }
export interface MemberView { userId: string; username: string; symbol: 'X' | 'O'; isBot: boolean }

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  at: number;
}

/** Định danh bot theo mã phòng để bot không lẫn với tài khoản thật. */
export const BOT_PREFIX = 'bot:';
export const botId = (code: string) => `${BOT_PREFIX}${code}`;
export const isBot = (userId: string) => userId.startsWith(BOT_PREFIX);

/** Định danh khách: tách biệt hoàn toàn với tài khoản thật. */
export const GUEST_PREFIX = 'guest:';
export const isGuestId = (userId: string) => userId.startsWith(GUEST_PREFIX);

export const displayName = (userId: string) => {
  if (isBot(userId)) return 'Máy';
  const guest = store.guests.get(userId);
  if (guest) return guest.username;
  return store.users.get(userId)?.username ?? '?';
};

export function lobbyView(code: string) {
  const lobby = store.lobbies.get(code);
  if (!lobby) return null;
  const members: MemberView[] = store.members.list(code).map((m) => ({
    userId: m.userId,
    username: displayName(m.userId),
    symbol: m.symbol,
    isBot: isBot(m.userId),
  }));
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    tier: lobby.tier,
    winLength: lobby.winLength,
    premoveEnabled: lobby.premoveEnabled,
    cameraFollow: lobby.cameraFollow,
    botDifficulty: lobby.botDifficulty,
    status: lobby.status,
    members,
    /** Ai sẽ đi trước ván tiếp theo (người thua ván trước). */
    nextFirstId: lobby.lastLoserId,
  };
}
