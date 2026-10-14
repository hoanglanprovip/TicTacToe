/**
 * Nhật ký hệ thống dạng vòng (ring buffer) trong bộ nhớ.
 * Chỉ tài khoản admin được xem qua API `/api/admin/*` — tài khoản thường không thấy gì.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'bot';

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  /** Nhóm sự kiện: auth, lobby, match, bot, admin… */
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

const MAX = 500;
const buffer: LogEntry[] = [];
let nextId = 1;

export function logEvent(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>): LogEntry {
  const entry: LogEntry = { id: nextId++, at: Date.now(), level, scope, message, meta };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  return entry;
}

/** Danh sách log mới nhất trước (mặc định lấy 100 dòng cuối). */
export function logs(limit = 100): LogEntry[] {
  return buffer.slice(-Math.max(1, Math.min(MAX, limit))).reverse();
}

export function clearLogs(): void {
  buffer.length = 0;
}

export const logCount = (): number => buffer.length;