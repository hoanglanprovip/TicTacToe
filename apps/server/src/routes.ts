import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  TIERS,
  isDifficulty,
  isTier,
  moderate,
  normalizeBrain,
  resolveRule,
  type BrainStats,
} from '@tt/engine';
import { botId, displayName, isBot, lobbyView, store, type UserRole } from './db.js';
import {
  cookieName,
  createGuest,
  ensureAdminUser,
  hashPassword,
  isAdmin,
  issueGuestToken,
  issueToken,
  userFromRequest,
  verifyPassword,
} from './auth.js';
import { clearLogs, logEvent, logs, logCount } from './log.js';
import { MAX_TRAIN_GAMES, cancelTrainingJob, isTraining, loadBrain, resetBrain, runTraining, startTrainingJob, trainingJob } from './trainer.js';

const SYMBOLS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // loại 0 O 1 I L dễ nhầm

function newCode(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    if (!store.lobbies.get(code)) return code;
  }
  throw new Error('Không sinh được mã phòng');
}

const fail = (code: string, message: string) => ({ code, message });
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 30 * 86_400,
};

/** Tên tài khoản không được chứa từ cấm và phải giữ được dạng chữ/số. */
const isCleanUsername = (value: string) => /^[a-zA-Z0-9_]+$/.test(value) && !moderate(value).blocked && moderate(value).hits === 0;

const publicUser = (user: { id: string; username: string; role?: UserRole; isGuest?: boolean }) => ({
  id: user.id,
  username: user.username,
  role: (user.role ?? 'user') as UserRole,
  isGuest: user.isGuest === true,
});

/** Chỉ tài khoản admin mới truy cập được nhóm API này. */
function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = userFromRequest(request);
  if (!user) {
    reply.code(401).send(fail('UNAUTHENTICATED', 'Bạn cần đăng nhập.'));
    return null;
  }
  if (!isAdmin(user)) {
    logEvent('warn', 'admin', `Truy cap bi tu choi tu ${user.username}`, { ip: request.ip });
    reply.code(403).send(fail('FORBIDDEN', 'Chỉ tài khoản admin mới xem được phần này.'));
    return null;
  }
  return user;
}

/** Người chơi khách không được đổi mật khẩu (vì không có mật khẩu). */
function requireAccountUser(request: FastifyRequest, reply: FastifyReply) {
  const user = userFromRequest(request);
  if (!user) {
    reply.code(401).send(fail('UNAUTHENTICATED', 'Bạn cần đăng nhập.'));
    return null;
  }
  if (user.isGuest) {
    reply.code(403).send(fail('GUEST_NO_PASSWORD', 'Phiên khách không có mật khẩu. Hãy đăng ký tài khoản nếu muốn lưu thành tích.'));
    return null;
  }
  return user;
}

/** Chuẩn hoá thống kê não bot cho client. */
const brainStats = (): BrainStats => normalizeBrain(store.bots.get('global')?.brain ?? null).stats;

export async function ensureAdminAccount() {
  const result = await ensureAdminUser();
  if (result.created) {
    logEvent('warn', 'auth', `Da tao tai khoan admin mac dinh "${result.username}" — hay doi mat khau ngay`);
    console.log(`[auth] Đã tạo tài khoản admin mặc định "${result.username}". Hãy đổi mật khẩu ngay.`);
  }
  return result;
}

export function registerRoutes(app: FastifyInstance, onLobbyChanged: (code: string) => void) {
/**
 * Kiểm tra sống — công khai, chỉ trả trạng thái tối thiểu.
 * TUYỆT ĐỐI không trả đường dẫn file, phiên bản, hay bất kỳ chi tiết nội bộ nào.
 */
app.get('/api/health', async () => ({ ok: store.health(), time: Date.now() }));

// Nhóm API quản trị bị giới hạn tần suất riêng (chặn lạm dụng/đoán).
const adminRateLimit = { max: 120, timeWindow: '1 minute' };

app.get('/api/tiers', async () => TIERS);

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/register', async (req, reply) => {
    const username = req.body?.username?.trim();
    const password = req.body?.password;
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return reply.code(400).send(fail('INVALID_USERNAME', 'Tên phải dài 3–20 ký tự, chỉ gồm chữ, số và dấu gạch dưới.'));
    }
    if (!password || password.length < 8) {
      return reply.code(400).send(fail('INVALID_PASSWORD', 'Mật khẩu cần ít nhất 8 ký tự.'));
    }
    if (username.toLowerCase() === 'admin') {
      return reply.code(409).send(fail('USERNAME_RESERVED', 'Tên này dành cho quản trị viên.'));
    }
    if (store.users.findByUsername(username)) {
      return reply.code(409).send(fail('USERNAME_TAKEN', 'Tên tài khoản đã có người dùng.'));
    }
    if (!isCleanUsername(username)) {
      return reply.code(400).send(fail('USERNAME_INAPPROPRIATE', moderate(username).reason));
    }
    const { hash, salt } = await hashPassword(password);
    const user = store.users.create({ id: randomUUID(), username, passHash: hash, passSalt: salt, createdAt: Date.now(), role: 'user' });
    logEvent('info', 'auth', `Tai khoan moi: ${username}`);
    reply.setCookie(cookieName, issueToken(user.id), cookieOptions);
    return { user: publicUser(user) };
  });

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const record = store.users.findByUsername(req.body?.username ?? '');
    const ok = record && (await verifyPassword(req.body?.password ?? '', record.passHash, record.passSalt));
    if (!ok) {
      logEvent('warn', 'auth', `Dang nhap that bai: "${req.body?.username ?? ''}"`);
      return reply.code(401).send(fail('BAD_CREDENTIALS', 'Tên tài khoản hoặc mật khẩu không đúng.'));
    }
    logEvent('info', 'auth', `${record.role === 'admin' ? 'Admin' : 'Nguoi choi'} dang nhap: ${record.username}`);
    reply.setCookie(cookieName, issueToken(record.id), cookieOptions);
    return { user: publicUser(record) };
  });

  /** Vào chơi ngay không cần tài khoản (phiên khách tự hết hạn sau 12 giờ). */
app.post<{ Body: { name?: string } }>('/api/auth/guest', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const result = createGuest(String(req.body?.name ?? ''), req.ip);
    if (!result.ok) return reply.code(result.error === 'RATE_LIMITED' ? 429 : 400).send(fail(result.error, result.message));

    reply.setCookie(cookieName, issueGuestToken(result.id), cookieOptions);
    logEvent('info', 'auth', `Khach moi: ${result.username} (${req.ip})`);
    return { user: { id: result.id, username: result.username, role: 'user' as const, isGuest: true } };
  });

  // Kiểm tra phiên chạy rất thường xuyên (mỗi lần tải trang) nên không tính vào rate limit.
  app.get('/api/auth/me', { config: { rateLimit: false } }, async (req, reply) => {
    const user = userFromRequest(req);
    return user ? { user: publicUser(user) } : reply.code(401).send(fail('UNAUTHENTICATED', 'Bạn cần đăng nhập.'));
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const user = userFromRequest(req);
    if (user) store.sessions.remove(user.jti);
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  /** Đổi mật khẩu của chính mình (dùng được cho mọi tài khoản, kể cả admin). */
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>('/api/auth/password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireAccountUser(req, reply);
    if (!user) return undefined;
    const record = store.users.get(user.id);
    if (!record) return reply.code(404).send(fail('NOT_FOUND', 'Không tìm thấy tài khoản.'));

    const current = req.body?.currentPassword ?? '';
    if (!(await verifyPassword(current, record.passHash, record.passSalt))) {
      logEvent('warn', 'auth', `${record.username} doi mat khau sai mat khau cu`);
      return reply.code(400).send(fail('BAD_CREDENTIALS', 'Mật khẩu hiện tại không đúng.'));
    }
    const next = req.body?.newPassword ?? '';
    if (next.length < 6) return reply.code(400).send(fail('INVALID_PASSWORD', 'Mật khẩu mới cần ít nhất 6 ký tự.'));

    const { hash, salt } = await hashPassword(next);
    store.users.setPassword(record.id, hash, salt);
    // Huỷ toàn bộ phiên cũ, buộc đăng nhập lại bằng mật khẩu mới.
    for (const session of store.sessions.list()) {
      if (session.userId === record.id) store.sessions.remove(session.jti);
    }
    logEvent('warn', 'auth', `DOI MAT KHAU THANH CONG cho ${record.username}${record.role === 'admin' ? ' (admin)' : ''}`);
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  /* ---------------- Khu vực quản trị: chỉ tài khoản admin ---------------- */

  app.get('/api/admin/overview', { config: { rateLimit: adminRateLimit } }, async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return undefined;

    const matches = store.matches.list();
    return {
      admin: publicUser(admin),
      bot: brainStats(),
      logs: logs(120),
      training: trainingJob(),
      system: {
        users: store.users.list().length,
        lobbies: store.lobbies.list().length,
        matches: matches.length,
        sessions: store.sessions.list().length,
        logLines: logCount(),
        maxTrainGames: MAX_TRAIN_GAMES,
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
      },
    };
  });

  /**
   * Bật train bot NỀN (worker thread) nên server vẫn phản hồi bình thường.
   * Trả về ngay job để admin theo dõi tiến độ qua /api/admin/overview.
   */
  app.post<{ Body: { games?: number; tier?: string; level?: string; opponent?: string } }>('/api/admin/train', { config: { rateLimit: adminRateLimit } }, async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return undefined;

    if (isTraining()) {
      return { job: trainingJob(), alreadyRunning: true };
    }

    const requested = Math.floor(Number(req.body?.games ?? 200));
    if (!Number.isFinite(requested) || requested < 1 || requested > MAX_TRAIN_GAMES) {
      return reply.code(400).send(fail('INVALID_GAMES', `Số ván phải từ 1 đến ${MAX_TRAIN_GAMES}.`));
    }

    const tier = String(req.body?.tier ?? 'classic');
    const level = String(req.body?.level ?? 'hard');
    const opponent = String(req.body?.opponent ?? 'easy');

    logEvent('bot', 'admin', `${admin.username} bat dau train bot: ${requested} van, che do ${tier} (bot chinh ${level}, doi thu ${opponent})`, {
      requested,
      tier,
      level,
      opponent,
    });

    const job = startTrainingJob({ games: requested, tier, level, opponent }, admin.username);
    return { job, alreadyRunning: false };
  });

  app.post('/api/admin/train/cancel', { config: { rateLimit: adminRateLimit } }, async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return undefined;
    return { cancelled: cancelTrainingJob(), job: trainingJob() };
  });

  app.post('/api/admin/bot/reset', { config: { rateLimit: adminRateLimit } }, async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return undefined;
    resetBrain();
    logEvent('warn', 'bot', `${admin.username} da xoa toan bo bai hoc cua bot`);
    return { stats: brainStats() };
  });

  app.get('/api/admin/users', { config: { rateLimit: adminRateLimit } }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return undefined;
    const matches = store.matches.list();
    return {
      users: store.users.list().map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        isBot: isBot(user.id),
        display: displayName(user.id),
        games: matches.filter((m) => {
          const state = m.state as { players?: Array<{ userId: string }> } | null;
          return state?.players?.some((p) => p.userId === user.id) ?? false;
        }).length,
      })),
    };
  });

  /** Admin đặt lại mật khẩu cho tài khoản khác (kể cả tài khoản bot). */
  app.post<{ Params: { id: string }; Body: { password?: string } }>('/api/admin/users/:id/password', { config: { rateLimit: adminRateLimit } }, async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return undefined;
    const target = store.users.get(req.params.id);
    if (!target) return reply.code(404).send(fail('NOT_FOUND', 'Không tìm thấy tài khoản này.'));

    const password = String(req.body?.password ?? '');
    if (password.length < 6) return reply.code(400).send(fail('INVALID_PASSWORD', 'Mật khẩu cần ít nhất 6 ký tự.'));

    const { hash, salt } = await hashPassword(password);
    store.users.setPassword(target.id, hash, salt);
    for (const session of store.sessions.list()) {
      if (session.userId === target.id) store.sessions.remove(session.jti);
    }
    logEvent('warn', 'admin', `${admin.username} dat lai mat khau cho ${target.username}`);
    return { ok: true, username: target.username };
  });

  app.post<{ Body: { tier?: string; vsBot?: boolean; botDifficulty?: string } }>('/api/lobbies', async (req, reply) => {
    const user = userFromRequest(req);
    if (!user) return reply.code(401).send(fail('UNAUTHENTICATED', 'Bạn cần đăng nhập.'));
    if (!isTier(req.body?.tier)) return reply.code(400).send(fail('INVALID_TIER', 'Chế độ chơi không hợp lệ.'));

    const rule = resolveRule({ tier: req.body.tier });
    const requestedDifficulty = req.body.botDifficulty;
    const code = newCode();
    store.lobbies.create({
      code,
      hostId: user.id,
      tier: rule.tier,
      winLength: rule.winLength,
      premoveEnabled: true,
      cameraFollow: true,
      botDifficulty: isDifficulty(requestedDifficulty) ? requestedDifficulty : 'normal',
      status: 'waiting',
      createdAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      lastLoserId: null,
    });
store.members.add(code, user.id, 'X');
    if (req.body.vsBot) store.members.add(code, botId(code), 'O');
    logEvent('info', 'lobby', `${user.username} tao phong ${code} (${rule.tier}${req.body.vsBot ? ', co bot' : ''})`);
    return { lobby: lobbyView(code) };
  });

  app.get<{ Params: { code: string } }>('/api/lobbies/:code', async (req, reply) => {
    const user = userFromRequest(req);
    if (!user) return reply.code(401).send(fail('UNAUTHENTICATED', 'Bạn cần đăng nhập.'));

    const code = req.params.code.toUpperCase();
    const lobby = store.lobbies.get(code);
    if (!lobby) return reply.code(404).send(fail('LOBBY_NOT_FOUND', 'Không tìm thấy phòng với mã này.'));
    if (lobby.status === 'waiting' && lobby.expiresAt < Date.now()) {
      return reply.code(410).send(fail('LOBBY_EXPIRED', 'Link phòng đã hết hạn.'));
    }

    const members = store.members.list(code);
    if (!members.some((m) => m.userId === user.id)) {
      if (lobby.status !== 'waiting') return reply.code(409).send(fail('LOBBY_IN_PROGRESS', 'Ván đã bắt đầu, không thể vào phòng.'));
      if (members.length >= 2) return reply.code(409).send(fail('LOBBY_FULL', 'Phòng đã đủ 2 người.'));
      store.members.add(code, user.id, members.some((m) => m.symbol === 'X') ? 'O' : 'X');
      onLobbyChanged(code);
    }
    return { lobby: lobbyView(code) };
  });

  // Thống kê não bot cũng là thông tin nội bộ → chỉ admin xem được.
  app.get('/api/bot', async (req, reply) => {
    if (!requireAdmin(req, reply)) return undefined;
    const raw = store.bots.get('global')?.brain;
    const brain = normalizeBrain(raw ?? null);
    return { stats: brain.stats };
  });

  app.get('/api/profile', async (req, reply) => {
    const user = userFromRequest(req);
    if (!user) return reply.code(401).send(fail('UNAUTHENTICATED', 'Bạn cần đăng nhập.'));

    // Khách: trả hồ sơ rỗng để giao diện không vỡ, kèm cờ để ẩn phần đổi mật khẩu.
    if (user.isGuest) {
      return {
        user: { id: user.id, username: user.username, role: 'user' as const, isGuest: true },
        stats: { total: 0, wins: 0, draws: 0 },
        matches: [],
      };
    }

    const mine = store.matches.list()
      .map((m) => m.state as { players: Array<{ userId: string }>; winnerId: string | null; reason: string | null; rule: { tier: string }; moves: unknown[]; startedAt: number | null })
      .filter((m) => m.players.some((p) => p.userId === user.id));

    return {
      user: { id: user.id, username: user.username, role: user.role, isGuest: false },
      stats: {
        total: mine.length,
        wins: mine.filter((m) => m.winnerId === user.id).length,
        draws: mine.filter((m) => m.reason === 'draw').length,
      },
      matches: mine
        .slice(-20)
        .reverse()
        .map((m) => ({
          matchId: m.rule.tier,
          tier: m.rule.tier,
          winnerId: m.winnerId,
          reason: m.reason,
          moves: m.moves.length,
          startedAt: m.startedAt,
        })),
    };
  });
}