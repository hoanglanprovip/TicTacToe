import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import { GUEST_PREFIX, store } from './db.js';

const scrypt = promisify(scryptCallback);
const secret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-in-production');
if (!secret) throw new Error('JWT_SECRET bắt buộc khi chạy production');

export const cookieName = 'tt_session';
const sign = (data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return { hash: hash.toString('hex'), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function issueToken(userId: string): string {
  const jti = randomUUID();
  const expiresAt = Date.now() + 30 * 86_400_000;
  store.sessions.create({ jti, userId, expiresAt });
  return signToken({ sub: userId, jti, exp: Math.floor(expiresAt / 1000) });
}

/** Phiên ngắn hạn cho người chơi khách (không có tài khoản, không mật khẩu). */
export function issueGuestToken(guestId: string): string {
  const jti = randomUUID();
  const expiresAt = Date.now() + GUEST_TTL_MS;
  store.sessions.create({ jti, userId: guestId, expiresAt });
  return signToken({ sub: guestId, jti, exp: Math.floor(expiresAt / 1000), guest: true });
}

function signToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

export interface AuthUser { id: string; username: string; role: 'user' | 'admin'; jti: string; isGuest?: boolean }

export function authenticate(token?: string): AuthUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  try {
    const a = Buffer.from(signature, 'base64url');
    const b = Buffer.from(sign(`${header}.${body}`), 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      sub?: string; jti?: string; exp?: number; guest?: boolean;
    };
    if (!payload.sub || !payload.jti || !payload.exp || payload.exp <= Date.now() / 1000) return null;
    if (!store.sessions.get(payload.jti)) return null;

    // Khách: tự xoá sau khi hết hạn, không có mật khẩu, không có vai trò admin.
    if (payload.guest) {
      const guest = store.guests.get(payload.sub);
      if (!guest) return null;
      store.guests.touch(payload.sub);
      return { id: guest.id, username: guest.username, role: 'user', jti: payload.jti, isGuest: true };
    }

    const user = store.users.get(payload.sub);
    return user ? { id: user.id, username: user.username, role: user.role ?? 'user', jti: payload.jti } : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Khách chơi không cần tài khoản                                      */
/* ------------------------------------------------------------------ */

/** Phiên khách sống 12 giờ rồi tự dọn. */
export const GUEST_TTL_MS = Number(process.env.GUEST_TTL_MS ?? 12 * 60 * 60 * 1000);
/** Tối đa số khách còn "sống" trên server. */
export const MAX_GUESTS = Number(process.env.MAX_GUESTS ?? 300);
/** Mỗi IP được tạo tối đa bao nhiêu phiên khách trong 1 giờ. */
export const GUEST_PER_IP_PER_HOUR = Number(process.env.GUEST_PER_IP_PER_HOUR ?? 12);

const guestHits = new Map<string, number[]>();

const guestNameTaken = (name: string) =>
  !!store.users.findByUsername(name) || store.guests.list().some((g) => g.username.toLowerCase() === name.toLowerCase());

export type GuestResult =
  | { ok: true; id: string; username: string }
  | { ok: false; error: 'INVALID_NAME' | 'NAME_TAKEN' | 'RATE_LIMITED' | 'TOO_MANY_GUESTS'; message: string };

/** Tạo phiên khách. Chặn tên đã dùng, giới hạn theo IP và tổng số khách. */
export function createGuest(rawName: string, ip: string): GuestResult {
  const username = rawName.replace(/\s+/g, ' ').trim();
  if (username.length < 2 || username.length > 16 || !/^[\p{L}\p{N} _.-]+$/u.test(username)) {
    return { ok: false, error: 'INVALID_NAME', message: 'Tên khách phải dài 2–16 ký tự, chỉ gồm chữ, số, dấu cách, `_`, `.`, `-`.' };
  }
  if (username.toLowerCase() === 'admin') {
    return { ok: false, error: 'NAME_TAKEN', message: 'Tên này dành cho quản trị viên.' };
  }
  if (guestNameTaken(username)) {
    return { ok: false, error: 'NAME_TAKEN', message: 'Tên này đã có người dùng, hãy chọn tên khác.' };
  }

  const now = Date.now();
  const recent = (guestHits.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= GUEST_PER_IP_PER_HOUR) {
    return { ok: false, error: 'RATE_LIMITED', message: 'Bạn đã tạo quá nhiều phiên khách. Hãy thử lại sau.' };
  }
  recent.push(now);
  guestHits.set(ip, recent);

  store.guests.prune(GUEST_TTL_MS, MAX_GUESTS);
  if (store.guests.list().length >= MAX_GUESTS) {
    return { ok: false, error: 'TOO_MANY_GUESTS', message: 'Server đang quá tải, hãy thử lại sau.' };
  }

  const id = `${GUEST_PREFIX}${randomUUID()}`;
  store.guests.create({ id, username, createdAt: now, lastSeen: now });
  return { ok: true, id, username };
}

export const userFromRequest = (request: FastifyRequest) => authenticate(request.cookies[cookieName]);

export function userFromCookie(raw?: string) {
  const cookie = raw?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${cookieName}=`));
  return authenticate(cookie?.slice(cookieName.length + 1));
}

export const isAdmin = (user: AuthUser | null): boolean => user?.role === 'admin';

/** Tài khoản admin mặc định: `admin` / `123` (đổi được trong trang hồ sơ hoặc từ acc admin). */
export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = '123';

/** Tạo tài khoản admin nếu chưa có. Mật khẩu lấy từ `ADMIN_PASSWORD`, mặc định `123`. */
export async function ensureAdminUser(): Promise<{ created: boolean; username: string }> {
  const existing = store.users.findByUsername(ADMIN_USERNAME);
  if (existing) {
    if (existing.role !== 'admin') store.users.setRole(existing.id, 'admin');
    return { created: false, username: existing.username };
  }
  const password = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  const { hash, salt } = await hashPassword(password);
  store.users.create({
    id: randomUUID(),
    username: ADMIN_USERNAME,
    passHash: hash,
    passSalt: salt,
    createdAt: Date.now(),
    role: 'admin',
  });
  return { created: true, username: ADMIN_USERNAME };
}