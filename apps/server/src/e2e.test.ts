import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'tt-e2e-'));
process.env.DB_PATH = join(dir, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.COUNTDOWN_MS = '150';
process.env.PREMOVE_LEAD_MS = '250';
process.env.RECONNECT_GRACE_MS = '500';
process.env.BOT_REMATCH_COUNTDOWN_MS = '150';

const { buildServer } = await import('../src/app.js');

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const sockets: Socket[] = [];

let app: FastifyInstance;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function once<T>(socket: Socket, event: string, timeout = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout chờ "${event}"`)), timeout);
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
}

/** Gom event để kiểm tra theo điều kiện, tránh race. Tìm từ item mới nhất về để không dính state cũ. */
function collector<T>(socket: Socket, event: string) {
  const items: T[] = [];
  socket.on(event, (payload: T) => items.push(payload));
  return {
    items,
    /** Xoá lịch sử để `until` chỉ nhìn các state phát ra SAU hành động đang kiểm tra. */
    reset() { items.length = 0; },
    async until(predicate: (item: T) => boolean, timeout = 4000): Promise<T> {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (item && predicate(item)) return item;
        }
        await wait(25);
      }
      throw new Error(`không nhận được "${event}" thỏa điều kiện`);
    },
  };
}

interface Session { cookie: string; id: string; username: string }

async function api(path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, ...rest } = init;
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { ...(rest.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const token = /tt_session=([^;]+)/.exec(setCookie)?.[1];
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body as Record<string, unknown>, token };
}

async function register(username: string): Promise<Session> {
  const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password: 'matkhau123' }) });
  expect(res.status).toBe(200);
  return { cookie: `tt_session=${res.token}`, id: (res.body.user as { id: string }).id, username };
}

function connect(session: Session): Promise<Socket> {
  const socket = ioClient(BASE, { extraHeaders: { cookie: session.cookie }, transports: ['websocket'] });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 5000);
  });
}

interface MatchSnapshot {
  status: string; turn: string | null; board: Array<{ x: number; y: number; symbol: string }>;
  players: Array<{ userId: string; username: string; symbol: string; premove: Array<{ x: number; y: number }>; stones: number }>;
  winnerId: string | null; reason: string | null; winningLine: Array<{ x: number; y: number }> | null;
  rule: { tier: string; winLength: number; size: number; boardType: string };
}

beforeAll(async () => {
  app = await buildServer({ port: PORT, host: '127.0.0.1', serveWeb: false, quiet: true });
}, 30_000);

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  sockets.length = 0;
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
}, 20_000);

describe('chế độ chơi với máy (bot)', () => {
  it('tạo phòng có bot ngay từ đầu và bot tự đánh', async () => {
    const host = await register('host_bot');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic', vsBot: true, botDifficulty: 'hard' }), cookie: host.cookie });
    expect(created.status).toBe(200);
    const code = (created.body.lobby as { code: string }).code;
    const lobby = created.body.lobby as { members: Array<{ username: string; isBot: boolean }>; botDifficulty: string };
    expect(lobby.members).toHaveLength(2);
    expect(lobby.members.filter((m) => m.isBot)).toHaveLength(1);
    expect(lobby.botDifficulty).toBe('hard');

    const socket = await connect(host);
    const states = collector<MatchSnapshot>(socket, 'match:state');
    socket.emit('lobby:join', { code });
    await wait(100);
    socket.emit('lobby:start');

    const started = await states.until((m) => m.status === 'playing');
    const bot = started.players.find((p) => p.userId.startsWith('bot:'))!;
    const human = started.players.find((p) => p.userId === host.id)!;
    expect(bot.username).toBe('Máy');
    expect(['X', 'O']).toContain(bot.symbol);
    expect(['X', 'O']).toContain(human.symbol);
    expect(bot.symbol).not.toBe(human.symbol);

    if (started.turn === bot.userId) {
      const botFirst = await states.until((m) => m.board.length === 1);
      expect(botFirst.board[0]?.symbol).toBe(bot.symbol);
      socket.emit('game:place', { x: 0, y: 0 });
    } else {
      socket.emit('game:place', { x: 0, y: 0 });
      // Khi lượt đang là của bot, người không được đánh thay
      socket.emit('game:place', { x: 2, y: 2 });
      const err = await once<{ error: string }>(socket, 'match:error');
      expect(err.error).toBe('NOT_YOUR_TURN');
    }

    const afterBot = await states.until((m) => m.board.length === 2);
    const botMove = afterBot.board.find((c) => c.symbol === bot.symbol);
    expect(botMove).toBeDefined();
    expect(new Set(afterBot.board.map((c) => `${c.x},${c.y}`)).size).toBe(2);
    expect(afterBot.players.find((p) => p.userId === human.userId)?.symbol).toBe(human.symbol);

    // Bỏ cuộc → bot thắng bất kể ai đã đi trước
    states.reset();
    socket.emit('game:resign');
    const ended = await states.until((m) => m.status === 'finished');
    expect(ended.winnerId).toBe(bot.userId);
    expect(ended.reason).toBe('resign');

    states.reset();
    socket.emit('lobby:rematch:request', { tier: 'big' });
    const nextGame = await states.until((m) => m.status === 'playing' && m.board.length === 0, 5000);
    expect(nextGame.players).toHaveLength(2);
    expect(nextGame.rule.tier).toBe('big');
    expect(nextGame.rule.winLength).toBe(4);

    socket.close();
  }, 30_000);

  it('thêm và gỡ bot trong phòng đang chờ', async () => {
    const host = await register('host_addbot');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'big' }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    expect((created.body.lobby as { members: unknown[] }).members).toHaveLength(1);

    const socket = await connect(host);
    const lobbies = collector<{ members: Array<{ isBot: boolean }> }>(socket, 'lobby:state');
    socket.emit('lobby:join', { code });
    await wait(100);

    socket.emit('lobby:addBot', { difficulty: 'easy' });
    const withBot = await lobbies.until((l) => l.members.some((m) => m.isBot));
    expect(withBot.members).toHaveLength(2);

    // Thêm lần 2 không được nhân bản
    socket.emit('lobby:addBot', {});
    await wait(120);
    expect((await api(`/api/lobbies/${code}`, { cookie: host.cookie })).body.lobby).toBeTruthy();
    const latest = lobbies.items[lobbies.items.length - 1]!;
    expect(latest.members.filter((m) => m.isBot)).toHaveLength(1);

    socket.emit('lobby:removeBot');
    const withoutBot = await lobbies.until((l) => !l.members.some((m) => m.isBot));
    expect(withoutBot.members).toHaveLength(1);

    socket.close();
  }, 30_000);

  it('bot chơi được bàn vô hạn, người đánh ở toạ độ xa bất kỳ', async () => {
    const host = await register('host_bot_inf');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'infinity', vsBot: true }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;

    const socket = await connect(host);
    const states = collector<MatchSnapshot>(socket, 'match:state');
    socket.emit('lobby:join', { code });
    await wait(100);
    socket.emit('lobby:start');
    const started = await states.until((m) => m.status === 'playing');
    expect(started.rule.boardType).toBe('infinite');

    const bot = started.players.find((p) => p.userId.startsWith('bot:'))!;
    let humanMove: { x: number; y: number };
    if (started.turn === bot.userId) {
      const botFirst = await states.until((m) => m.board.length === 1, 5000);
      const first = botFirst.board[0]!;
      humanMove = { x: first.x + 1, y: first.y };
      socket.emit('game:place', humanMove);
    } else {
      humanMove = { x: 45, y: -28 };
      socket.emit('game:place', humanMove);
    }
    const after = await states.until((m) => m.board.length === 2, 5000);
    const botMove = after.board.find((c) => c.symbol === bot.symbol)!;
    expect(botMove).toBeDefined();
    const other = after.board.find((c) => c.symbol !== bot.symbol)!;
    expect(other).toMatchObject(humanMove);

    socket.close();
  }, 30_000);
});

describe('luật đi trước và bot tự học', () => {
  it('người thua ván trước được đi trước ván sau', async () => {
    const host = await register('host_nholo');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic', vsBot: true }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;

    const socket = await connect(host);
    const states = collector<MatchSnapshot>(socket, 'match:state');
    socket.emit('lobby:join', { code });
    await wait(100);
    socket.emit('lobby:start');

    const started = await states.until((m) => m.status === 'playing');
    const bot = started.players.find((p) => p.userId.startsWith('bot:'))!;

    // Người chơi bỏ cuộc → thua ván này
    states.reset();
    socket.emit('game:resign');
    const ended = await states.until((m) => m.status === 'finished');
    expect(ended.winnerId).toBe(bot.userId);

    // Ván sau phải để người thua (người chơi) đi trước
    states.reset();
    socket.emit('lobby:rematch:request', { tier: 'classic' });
    const next = await states.until((m) => m.status === 'playing' && m.board.length === 0, 6000);
    const human = next.players.find((p) => p.userId === host.id)!;
    expect(human.symbol).toBe('X');
    expect(next.turn).toBe(human.userId);

    // Bỏ cuộc lần nữa → bot lại thắng, người chơi lại được đi trước ván sau
    states.reset();
    socket.emit('game:resign');
    await states.until((m) => m.status === 'finished');
    states.reset();
    socket.emit('lobby:rematch:request', { tier: 'classic' });
    const third = await states.until((m) => m.status === 'playing' && m.board.length === 0, 6000);
    expect(third.players.find((p) => p.userId === host.id)?.symbol).toBe('X');

    socket.close();
  }, 30_000);

  it('bot ghi nhận kinh nghiệm sau mỗi ván có kết quả', async () => {
    const adminLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD ?? '123' }),
    });
    const adminCookie = `tt_session=${adminLogin.token}`;
    const botStats = async () =>
      ((await api('/api/admin/overview', { cookie: adminCookie })).body as unknown as { bot: { games: number; lessons: number; level: number } }).bot;
    const before = await botStats();

    const host = await register('host_hocbot');
    const created = await api('/api/lobbies', {
      method: 'POST',
      body: JSON.stringify({ tier: 'classic', vsBot: true, botDifficulty: 'hard' }),
      cookie: host.cookie,
    });
    const code = (created.body.lobby as { code: string }).code;

    const socket = await connect(host);
    const states = collector<MatchSnapshot>(socket, 'match:state');
    socket.emit('lobby:join', { code });
    await wait(100);
    socket.emit('lobby:start');
    await states.until((m) => m.status === 'playing');

    const taken = new Set<string>();
    const deadline = Date.now() + 8000;

    while (Date.now() < deadline) {
      const snapshot = states.items[states.items.length - 1]!;
      if (snapshot.status === 'finished') break;
      if (snapshot.turn === host.id) {
        for (const [x, y] of [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]) {
          const key = `${x},${y}`;
          if (taken.has(key)) continue;
          if (snapshot.board.some((c) => c.x === x && c.y === y)) continue;
          taken.add(key);
          socket.emit('game:place', { x, y });
          break;
        }
      }
      await wait(60);
    }

    const finished = await states.until((m) => m.status === 'finished', 8000);
    expect(['win', 'draw']).toContain(finished.reason);

    const after = await botStats();
    expect(after.games).toBe(before.games + 1);
    expect(after.lessons).toBeGreaterThanOrEqual(before.lessons);
    expect(after.level).toBeGreaterThanOrEqual(before.level);

    socket.close();
  }, 30_000);
});

describe('tài khoản admin và khu vực quản trị', () => {
  const login = async (username: string, password: string) =>
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });

  it('tài khoản admin mặc định tồn tại và đăng nhập được', async () => {
    const res = await login('admin', process.env.ADMIN_PASSWORD ?? '123');
    expect(res.status).toBe(200);
    const user = res.body.user as { username: string; role: string };
    expect(user.username).toBe('admin');
    expect(user.role).toBe('admin');
  }, 15_000);

  it('tài khoản thường bị chặn khỏi API quản trị', async () => {
    const normal = await register('user_thuong');
    const overview = await api('/api/admin/overview', { cookie: normal.cookie });
    expect(overview.status).toBe(403);
    expect((overview.body as { code: string }).code).toBe('FORBIDDEN');

    const users = await api('/api/admin/users', { cookie: normal.cookie });
    expect(users.status).toBe(403);

    const train = await api('/api/admin/train', { method: 'POST', body: JSON.stringify({ games: 1 }), cookie: normal.cookie });
    expect(train.status).toBe(403);

    // Thống kê não bot cũng là thông tin nội bộ, acc thường không xem được.
    expect((await api('/api/bot', { cookie: normal.cookie })).status).toBe(403);
  }, 15_000);

  it('admin xem được log, danh sách tài khoản và huấn luyện bot', async () => {
    const admin = await login('admin', process.env.ADMIN_PASSWORD ?? '123');
    expect(admin.status).toBe(200);
    const cookie = `tt_session=${admin.token}`;

    const overview = await api('/api/admin/overview', { cookie });
    expect(overview.status).toBe(200);
    const data = overview.body as unknown as { bot: { level: number }; logs: unknown[]; system: { users: number } };
    expect(data.bot.level).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.system.users).toBeGreaterThan(0);

    const users = await api('/api/admin/users', { cookie });
    expect(users.status).toBe(200);
    const list = (users.body as unknown as { users: Array<{ username: string; role: string }> }).users;
    expect(list.some((u) => u.username === 'admin' && u.role === 'admin')).toBe(true);

    // Train chạy NỀN: API phải trả về ngay, không treo request.
    const t0 = Date.now();
    const trained = await api('/api/admin/train', {
      method: 'POST',
      body: JSON.stringify({ games: 6, tier: 'classic', level: 'hard', opponent: 'easy' }),
      cookie,
    });
    const tookMs = Date.now() - t0;
    expect(trained.status).toBe(200);
    const job = (trained.body as unknown as { job: { id: string; running: boolean; total: number }; alreadyRunning: boolean }).job;
    expect(job.running).toBe(true);
    expect(job.total).toBe(6);
    expect(tookMs).toBeLessThan(3000);

    // Server vẫn phản hồi trong lúc train (worker chạy riêng).
    const health = await api('/api/health');
    expect(health.status).toBe(200);

    // Đọc log được ngay khi đang train.
    const during = await api('/api/admin/overview', { cookie });
    const duringLogs = (during.body as unknown as { logs: Array<{ message: string }>; training: { done: number; running: boolean } }).logs;
    expect(duringLogs.some((l) => l.message.includes('bat dau train bot'))).toBe(true);

    // Chờ job xong rồi kiểm tra não đã lưu.
    const deadline = Date.now() + 40_000;
    let finished = false;
    while (Date.now() < deadline && !finished) {
      const ov = await api('/api/admin/overview', { cookie });
      const current = (ov.body as unknown as { training: { running: boolean; done: number; total: number } }).training;
      if (current && !current.running) {
        finished = true;
        expect(current.done).toBe(current.total);
      }
      await wait(120);
    }
    expect(finished).toBe(true);

    const after = await api('/api/admin/overview', { cookie });
    const payload = after.body as unknown as { bot: { games: number }; logs: Array<{ message: string }> };
    expect(payload.bot.games).toBeGreaterThan(data.bot.games + 0);
    expect(payload.logs.some((l) => l.message.includes('Train xong'))).toBe(true);
  }, 60_000);

  it('không ai tự đăng ký được tên admin', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'matkhau123' }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('USERNAME_RESERVED');
  }, 15_000);

  it('đổi mật khẩu được và phiên cũ bị huỷ', async () => {
    const user = await register('doi_mat_khau');
    const changed = await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'sai-mat-khau', newPassword: 'matkhau123' }),
      cookie: user.cookie,
    });
    expect(changed.status).toBe(400);

    const ok = await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'matkhau123', newPassword: 'matkhau456' }),
      cookie: user.cookie,
    });
    expect(ok.status).toBe(200);

    // Phiên cũ đã bị huỷ → phải đăng nhập lại bằng mật khẩu mới.
    expect((await api('/api/auth/me', { cookie: user.cookie })).status).toBe(401);
    expect((await login('doi_mat_khau', 'matkhau123')).status).toBe(401);
    expect((await login('doi_mat_khau', 'matkhau456')).status).toBe(200);
  }, 15_000);
});

describe('bảo vệ thông tin nhạy cảm', () => {
  it('API công khai không lộ chi tiết nội bộ', async () => {
    const health = await api('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, time: expect.any(Number) });
    // Không được lộ đường dẫn file dữ liệu hay phiên bản.
    expect(Object.keys(health.body)).toEqual(['ok', 'time']);
    expect(JSON.stringify(health.body)).not.toMatch(/game\.json|\.ts|node/i);

    const tiers = await api('/api/tiers');
    expect(tiers.status).toBe(200);
    expect(JSON.stringify(tiers.body)).not.toMatch(/secret|password|hash/i);
  });

  it('mọi API quản trị đều chặn khách chưa đăng nhập', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/users', '/api/bot']) {
      const res = await api(path);
      expect(res.status).toBe(401);
    }
    const train = await api('/api/admin/train', { method: 'POST', body: JSON.stringify({ games: 1 }) });
    expect(train.status).toBe(401);
    const reset = await api('/api/admin/bot/reset', { method: 'POST', body: JSON.stringify({}) });
    expect(reset.status).toBe(401);
  });

  it('không đọc được file dữ liệu qua đường dẫn trên web', async () => {
    for (const path of ['/data/game.json', '/../data/game.json', '/..%2Fdata%2Fgame.json', '/src/db.ts']) {
      const res = await api(path);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/"users"|passHash|passSalt|JWT_SECRET/);
    }
  });

  it('bundle web không chứa bí mật của server', async () => {
    // Trong môi trường test không phục vụ web, nên kiểm tra trực tiếp file đã build nếu có.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dist = path.resolve('..', 'web', 'dist', 'assets');
    if (!fs.existsSync(dist)) return;
    const bundles = fs.readdirSync(dist).filter((f) => f.endsWith('.js'));
    for (const file of bundles) {
      const content = fs.readFileSync(path.join(dist, file), 'utf8');
      expect(content).not.toMatch(/JWT_SECRET|ADMIN_PASSWORD|passHash|passSalt|dev-only-secret/);
    }
  });
});

describe('chế độ khách (vào chơi không cần tài khoản)', () => {
  const guestName = 'Khach Test';

  it('tạo được phiên khách bằng tên và vào chơi được', async () => {
    const res = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: guestName }) });
    expect(res.status).toBe(200);
    const user = res.body.user as { id: string; username: string; role: string; isGuest: boolean };
    expect(user.username).toBe(guestName);
    expect(user.role).toBe('user');
    expect(user.isGuest).toBe(true);
    expect(user.id.startsWith('guest:')).toBe(true);

    const cookie = `tt_session=${res.token}`;
    // Phiên khách dùng được như tài khoản: đọc hồ sơ, tạo phòng, vào phòng.
    const me = await api('/api/auth/me', { cookie });
    expect(me.status).toBe(200);

    const profile = await api('/api/profile', { cookie });
    expect(profile.status).toBe(200);
    expect((profile.body as { stats: { total: number } }).stats.total).toBe(0);

    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic' }), cookie });
    expect(created.status).toBe(200);
    const code = (created.body.lobby as { code: string }).code;

    const socket = await connect({ cookie, id: user.id, username: guestName });
    const lobbies = collector<{ members: Array<{ username: string }> }>(socket, 'lobby:state');
    socket.emit('lobby:join', { code });
    await wait(150);
    const lobby = await lobbies.until((l) => l.members.length >= 1);
    expect(lobby.members[0]?.username).toBe(guestName);
    socket.close();
  }, 20_000);

  it('khách không chạm được vào khu vực quản trị hay đổi mật khẩu', async () => {
    const res = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: 'Khach Quyen' }) });
    const cookie = `tt_session=${res.token}`;

    expect((await api('/api/admin/overview', { cookie })).status).toBe(403);
    expect((await api('/api/admin/users', { cookie })).status).toBe(403);
    expect((await api('/api/bot', { cookie })).status).toBe(403);
    const train = await api('/api/admin/train', { method: 'POST', body: JSON.stringify({ games: 1 }), cookie });
    expect(train.status).toBe(403);

    const change = await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: '', newPassword: 'matkhau123' }),
      cookie,
    });
    expect(change.status).toBe(403);
    expect((change.body as { code: string }).code).toBe('GUEST_NO_PASSWORD');
  }, 20_000);

  it('từ chối tên khách không hợp lệ, tên trùng và tên admin', async () => {
    const bad = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: 'a' }) });
    expect(bad.status).toBe(400);

    const symbols = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: '<script>x</script>' }) });
    expect(symbols.status).toBe(400);

    const admin = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: 'admin' }) });
    expect(admin.status).toBe(400);
    expect((admin.body as { code: string }).code).toBe('NAME_TAKEN');

    // Tên trùng với phiên khách đã tạo
    const first = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: 'Khach Trung' }) });
    expect(first.status).toBe(200);
    const second = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: 'Khach Trung' }) });
    expect(second.status).toBe(400);
  }, 20_000);

  it('đăng xuất được và phiên khách không tạo tài khoản trong danh sách user', async () => {
    const res = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ name: 'Khach Thoat' }) });
    const cookie = `tt_session=${res.token}`;

    expect((await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}), cookie })).status).toBe(200);
    expect((await api('/api/auth/me', { cookie })).status).toBe(401);

    const admin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD ?? '123' }) });
    const list = await api('/api/admin/users', { cookie: `tt_session=${admin.token}` });
    const names = (list.body as { users: Array<{ username: string }> }).users.map((u) => u.username);
    expect(names).not.toContain('Khach Thoat');
  }, 20_000);
});

describe('lọc nội dung chat', () => {
  it('che từ cấm và báo cho người gửi', async () => {
    const host = await register('host_chat');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic', vsBot: true }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    const socket = await connect(host);
    socket.emit('lobby:join', { code });
    await wait(100);

    const messages = collector<{ text: string }>(socket, 'chat:message');
    const moderated = collector<{ reason: string }>(socket, 'chat:moderated');
    const rejected = collector<{ reason: string }>(socket, 'chat:rejected');

    // Tin nhắn sạch: vẫn gửi nguyên văn
    socket.emit('chat:send', { text: 'chào bạn' });
    expect((await messages.until((m) => m.text.includes('chào'))).text).toBe('chào bạn');

    // Tin nhắn lẫn từ cấm: che từ đó nhưng vẫn gửi đi
    socket.emit('chat:send', { text: 'what the fuck' });
    const masked = await messages.until((m) => m.text.includes('*'));
    expect(masked.text).not.toContain('fuck');
    expect((await moderated.until((m) => m.reason !== '')).reason).not.toBe('');

    // Toàn bộ là từ cấm: chặn hẳn, không vào phòng
    const before = messages.items.length;
    socket.emit('chat:send', { text: 'fuck you' });
    expect((await rejected.until((m) => m.reason !== '')).reason).not.toBe('');
    await wait(250);
    expect(messages.items.length).toBe(before);

    socket.close();
  }, 30_000);

  it('từ chối tài khoản chứa từ cấm', async () => {
    const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'fucklord', password: 'matkhau123' }) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('USERNAME_INAPPROPRIATE');
  });

  it('cho phép tên sạch dù chứa từ giống', async () => {
    const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'con_nghe', password: 'matkhau123' }) });
    expect(res.status).toBe(200);
  });
});

describe('tài khoản', () => {
  it('đăng ký, đăng nhập lại và xác thực qua cookie', async () => {
    const session = await register('alice_e2e');
    const me = await api('/api/auth/me', { cookie: session.cookie });
    expect(me.status).toBe(200);
    expect((me.body.user as { username: string }).username).toBe('alice_e2e');

    const dup = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'alice_e2e', password: 'matkhau123' }) });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('USERNAME_TAKEN');
  });

  it('từ chối username và mật khẩu không hợp lệ', async () => {
    const bad = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'a!', password: 'matkhau123' }) });
    expect(bad.body.code).toBe('INVALID_USERNAME');
    const short = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'goodname', password: '123' }) });
    expect(short.body.code).toBe('INVALID_PASSWORD');
  });

  it('sai mật khẩu thì không vào được', async () => {
    const session = await register('bob_e2e');
    const wrong = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'bob_e2e', password: 'saisaisai' }) });
    expect(wrong.status).toBe(401);
    const me = await api('/api/auth/me', { cookie: session.cookie });
    expect(me.status).toBe(200);
  });

  it('chưa đăng nhập thì bị chặn', async () => {
    const res = await api('/api/lobbies/ZZZZZZ');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('lobby: tạo, mời bằng link, vào phòng', () => {
  it('vòng đời đầy đủ với 2 tài khoản', async () => {
    const host = await register('host_lobby');
    const guest = await register('guest_lobby');

    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic' }), cookie: host.cookie });
    expect(created.status).toBe(200);
    const code = (created.body.lobby as { code: string }).code;
    expect(code).toHaveLength(6);
    expect((created.body.lobby as { members: unknown[] }).members).toHaveLength(1);

    const bad = await api('/api/lobbies/NOPE99', { cookie: guest.cookie });
    expect(bad.status).toBe(404);
    expect(bad.body.code).toBe('LOBBY_NOT_FOUND');

    const joined = await api(`/api/lobbies/${code}`, { cookie: guest.cookie });
    expect(joined.status).toBe(200);
    const members = (joined.body.lobby as { members: Array<{ username: string }> }).members;
    expect(members.map((m) => m.username).sort()).toEqual(['guest_lobby', 'host_lobby']);

    const third = await register('third_lobby');
    const full = await api(`/api/lobbies/${code}`, { cookie: third.cookie });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('LOBBY_FULL');
  });

  it('cập nhật riêng từng setting và không nhân đôi thành viên khi join lặp', async () => {
    const host = await register('host_lobby_settings');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'infinity' }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    const socket = await connect(host);
    const states = collector<{ members: Array<{ userId: string }>; premoveEnabled: boolean; cameraFollow: boolean; tier: string; winLength: number }>(socket, 'lobby:state');

    socket.emit('lobby:join', { code });
    await states.until((s) => s.members.length === 1);
    socket.emit('lobby:update', { premoveEnabled: false });
    expect((await states.until((s) => !s.premoveEnabled)).premoveEnabled).toBe(false);
    socket.emit('lobby:update', { cameraFollow: false });
    expect((await states.until((s) => !s.cameraFollow)).cameraFollow).toBe(false);
    socket.emit('lobby:update', { tier: 'big' });
    expect((await states.until((s) => s.tier === 'big')).winLength).toBe(4);
    socket.emit('lobby:update', { tier: 'infinity' });
    expect((await states.until((s) => s.tier === 'infinity' && s.winLength === 5)).winLength).toBe(5);
    socket.emit('lobby:join', { code });
    const joinedAgain = await states.until((s) => s.members.length === 1 && !s.cameraFollow);
    expect(joinedAgain.members).toHaveLength(1);

    socket.close();
  });

  it('chuyển chủ phòng khi host rời; xoá lobby khi người cuối rời', async () => {
    const host = await register('host_leave_lobby');
    const guest = await register('guest_leave_lobby');
    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic' }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    await api(`/api/lobbies/${code}`, { cookie: guest.cookie });

    const hostSocket = await connect(host);
    const guestSocket = await connect(guest);
    const states = collector<{ hostId: string; members: Array<{ userId: string }> }>(guestSocket, 'lobby:state');
    hostSocket.emit('lobby:join', { code });
    guestSocket.emit('lobby:join', { code });
    await states.until((s) => s.members.length === 2);

    hostSocket.emit('lobby:leave');
    expect((await states.until((s) => s.hostId === guest.id && s.members.length === 1)).hostId).toBe(guest.id);
    guestSocket.emit('lobby:leave');
    await wait(100);
    expect((await api(`/api/lobbies/${code}`, { cookie: guest.cookie })).status).toBe(404);
    hostSocket.close();
    guestSocket.close();
  });
});

describe('ván đấu realtime 2 người', () => {
  it('chơi trọn ván, thắng, chat, rematch', async () => {
    const host = await register('host_play');
    const guest = await register('guest_play');

    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic' }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    await api(`/api/lobbies/${code}`, { cookie: guest.cookie });

    const hostSocket = await connect(host);
    const guestSocket = await connect(guest);
    const hostMatch = collector<MatchSnapshot>(hostSocket, 'match:state');
    const guestMatch = collector<MatchSnapshot>(guestSocket, 'match:state');
    const countdownEvent = once<{ ms: number; endsAt: number }>(hostSocket, 'match:countdown');

    hostSocket.emit('lobby:join', { code });
    guestSocket.emit('lobby:join', { code });
    await wait(120);

    hostSocket.emit('lobby:start');
    const countdown = await countdownEvent;
    expect(countdown.ms).toBeGreaterThan(0);
    expect(countdown.endsAt).toBeGreaterThan(Date.now());
    const started = await hostMatch.until((m) => m.status === 'playing');
    expect(started.rule.tier).toBe('classic');
    expect(started.rule.winLength).toBe(3);
    expect(started.players).toHaveLength(2);

    // Người vào sau được đi X ở ván mới
    const xPlayer = started.players.find((p) => p.symbol === 'X')!;
    const oPlayer = started.players.find((p) => p.symbol === 'O')!;
    expect(started.turn).toBe(xPlayer.userId);

    const hostSocketIsX = xPlayer.userId === host.id;
    const hostMoves = hostSocketIsX ? hostSocket : guestSocket;
    const guestMoves = hostSocketIsX ? guestSocket : hostSocket;

    // Đi sai lượt phải bị chặn
    guestMoves.emit('game:place', { x: 0, y: 0 });
    const error = await once<{ error: string }>(guestMoves, 'match:error');
    expect(error.error).toBe('NOT_YOUR_TURN');

    // Ô ngoài bàn bị chặn
    hostMoves.emit('game:place', { x: 9, y: 9 });
    const bounds = await once<{ error: string }>(hostMoves, 'match:error');
    expect(bounds.error).toBe('out_of_bounds');

    // Chat hoạt động
    guestMoves.emit('chat:send', { text: 'sẵn sàng' });
    const chat = await once<{ text: string }>(hostSocket, 'chat:message');
    expect(chat.text).toBe('sẵn sàng');

    // X thắng bằng cột 0. X đánh 3 quân trước khi O kịp đánh quân thứ 3.
    const winLine: Array<[number, number]> = [[0, 0], [0, 1], [0, 2]];
    const oReplies: Array<[number, number]> = [[1, 0], [2, 1]];
    for (let i = 0; i < 2; i += 1) {
      hostMoves.emit('game:place', { x: winLine[i]![0], y: winLine[i]![1] });
      await hostMatch.until((m) => m.board.length === i * 2 + 1);
      guestMoves.emit('game:place', { x: oReplies[i]![0], y: oReplies[i]![1] });
      await hostMatch.until((m) => m.board.length === i * 2 + 2);
    }
    hostMoves.emit('game:place', { x: winLine[2]![0], y: winLine[2]![1] });

    const finished = await hostMatch.until((m) => m.status === 'finished');
    expect(finished.winnerId).toBe(xPlayer.userId);
    expect(finished.reason).toBe('win');
    expect(finished.winningLine).toHaveLength(3);
    const guestView = await guestMatch.until((m) => m.status === 'finished');
    expect(guestView.winnerId).toBe(xPlayer.userId);

    // Người chơi gửi lời mời; đối thủ phải chấp nhận trước khi bắt đầu countdown.
    const guestRematchRequest = once<{ requesterId: string; tier: string }>(guestSocket, 'match:rematch-request');
    const guestRematchResponse = once<{ accepted: boolean }>(guestSocket, 'match:rematch-response');
    hostSocket.emit('lobby:rematch:request', { tier: 'infinity' });
    const rematchInvite = await guestRematchRequest;
    expect(rematchInvite.requesterId).toBe(host.id);
    expect(rematchInvite.tier).toBe('infinity');
    guestSocket.emit('lobby:rematch:respond', { accept: true });
    expect((await guestRematchResponse).accepted).toBe(true);
    hostMatch.reset();
    const rematch = await hostMatch.until((m) => m.status === 'playing' && m.board.length === 0);
    expect(rematch.players).toHaveLength(2);
    expect(rematch.rule.tier).toBe('infinity');
    expect(rematch.rule.winLength).toBe(5);

    // Bỏ cuộc
    hostMatch.reset();
    guestSocket.emit('game:resign');
    const resigned = await hostMatch.until((m) => m.status === 'finished' && m.reason === 'resign');
    const newMatch = rematch.players;
    const winner = newMatch.find((p) => p.userId !== guest.id)!;
    expect(resigned.winnerId).toBe(winner.userId);

    const declineRequest = once<{ requesterId: string }>(guestSocket, 'match:rematch-request');
    const declineResponse = once<{ accepted: boolean }>(hostSocket, 'match:rematch-response');
    guestSocket.emit('lobby:rematch:request');
    expect((await declineRequest).requesterId).toBe(guest.id);
    hostSocket.emit('lobby:rematch:respond', { accept: false });
    expect((await declineResponse).accepted).toBe(false);

    hostSocket.close();
    guestSocket.close();
  }, 30_000);

  it('pre-move tự đánh và bị huỷ khi ô đã bị chiếm', async () => {
    const host = await register('host_pre');
    const guest = await register('guest_pre');

    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic' }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    await api(`/api/lobbies/${code}`, { cookie: guest.cookie });

    const hostSocket = await connect(host);
    const guestSocket = await connect(guest);
    const states = collector<MatchSnapshot>(hostSocket, 'match:state');
    const hostStates = collector<MatchSnapshot>(guestSocket, 'match:state');

    hostSocket.emit('lobby:join', { code });
    guestSocket.emit('lobby:join', { code });
    await wait(120);
    hostSocket.emit('lobby:start');
    const started = await states.until((m) => m.status === 'playing');
    states.reset();
    hostStates.reset();

    const xPlayer = started.players.find((p) => p.symbol === 'X')!;
    const oPlayer = started.players.find((p) => p.symbol === 'O')!;
    const xSocket = xPlayer.userId === host.id ? hostSocket : guestSocket;
    const oSocket = xPlayer.userId === host.id ? guestSocket : hostSocket;

    // O xếp trước 2 nước khi chưa tới lượt
    oSocket.emit('game:premove', { cells: [{ x: 2, y: 2 }, { x: 1, y: 1 }] });
    await hostStates.until((m) => m.players.find((p) => p.userId === oPlayer.userId)!.premove.length === 2);

    // X đánh → sau PREMOVE_LEAD_MS server tự ăn nước của O
    xSocket.emit('game:place', { x: 0, y: 0 });
    await states.until((m) => m.board.length === 2);
    const afterAuto = await states.until((m) => m.board.some((c) => c.x === 2 && c.y === 2), 4000);
    expect(afterAuto.board.find((c) => c.x === 2 && c.y === 2)?.symbol).toBe('O');
    // Sau khi ăn nước trước của O thì lượt quay về X
    expect(afterAuto.turn).toBe(xPlayer.userId);
    expect(afterAuto.players.find((p) => p.userId === oPlayer.userId)!.premove).toHaveLength(1);

    // O xếp nước mà X sẽ chiếm trước
    oSocket.emit('game:premove', { cells: [{ x: 0, y: 1 }] });
    await hostStates.until((m) => m.players.find((p) => p.userId === oPlayer.userId)!.premove.length === 1);
    // Chờ hết lượt O: đặt nước thật để nhường lượt cho X
    oSocket.emit('game:place', { x: 1, y: 0 });
    await states.until((m) => m.turn === xPlayer.userId);
    // X chiếm mất ô mà O đã xếp
    xSocket.emit('game:place', { x: 0, y: 1 });
    await states.until((m) => m.board.some((c) => c.x === 0 && c.y === 1 && c.symbol === 'X'));
    // Khi tới lượt O, nước xếp bị huỷ
    const cancelled = await once<{ cancelled: { x: number; y: number } }>(hostSocket, 'match:premove');
    expect(cancelled.cancelled).toEqual({ x: 0, y: 1 });

    hostSocket.close();
    guestSocket.close();
  }, 30_000);

  it('bàn vô hạn: cả hai người được đánh ở vị trí tuỳ ý', async () => {
    const host = await register('host_inf');
    const guest = await register('guest_inf');

    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'infinity' }), cookie: host.cookie });
    expect((created.body.lobby as { tier: string }).tier).toBe('infinity');
    const code = (created.body.lobby as { code: string }).code;
    await api(`/api/lobbies/${code}`, { cookie: guest.cookie });

    const hostSocket = await connect(host);
    const guestSocket = await connect(guest);
    const states = collector<MatchSnapshot>(hostSocket, 'match:state');

    hostSocket.emit('lobby:join', { code });
    guestSocket.emit('lobby:join', { code });
    await wait(120);
    hostSocket.emit('lobby:start');
    const started = await states.until((m) => m.status === 'playing');
    expect(started.rule.boardType).toBe('infinite');
    expect(started.rule.winLength).toBe(5);

    const xPlayer = started.players.find((p) => p.symbol === 'X')!;
    const xSocket = xPlayer.userId === host.id ? hostSocket : guestSocket;
    const oSocket = xPlayer.userId === host.id ? guestSocket : hostSocket;

    xSocket.emit('game:place', { x: 5, y: 5 });
    await states.until((m) => m.board.length === 1);

    oSocket.emit('game:place', { x: 20, y: 20 });
    const placed = await states.until((m) => m.board.length === 2);
    expect(placed.board).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 5, y: 5 }),
      expect.objectContaining({ x: 20, y: 20 }),
    ]));

    hostSocket.close();
    guestSocket.close();
  }, 30_000);

  it('người thứ 3 không vào được ván đang chơi', async () => {
    const host = await register('host_busy');
    const guest = await register('guest_busy');
    const late = await register('late_busy');

    const created = await api('/api/lobbies', { method: 'POST', body: JSON.stringify({ tier: 'classic' }), cookie: host.cookie });
    const code = (created.body.lobby as { code: string }).code;
    await api(`/api/lobbies/${code}`, { cookie: guest.cookie });

    const hostSocket = await connect(host);
    const guestSocket = await connect(guest);
    hostSocket.emit('lobby:join', { code });
    guestSocket.emit('lobby:join', { code });
    await wait(120);
    hostSocket.emit('lobby:start');
    await collector<MatchSnapshot>(hostSocket, 'match:state').until((m) => m.status === 'playing');

    const lateSocket = await connect(late);
    lateSocket.emit('lobby:join', { code });
    const err = await once<{ code: string }>(lateSocket, 'lobby:error');
    // Ván đã bắt đầu nên báo IN_PROGRESS chứ không phải FULL
    expect(err.code).toBe('LOBBY_IN_PROGRESS');

    hostSocket.close();
    guestSocket.close();
    lateSocket.close();
  }, 30_000);

  it('socket không xác thực thì bị từ chối', async () => {
    const socket = ioClient(BASE, { transports: ['websocket'] });
    const result = await new Promise<string>((resolve) => {
      socket.once('connect', () => resolve('connected'));
      socket.once('connect_error', (e) => resolve(`error:${e.message}`));
    });
    expect(result).toContain('error');
    socket.close();
  }, 15_000);
});
