import type { AdminOverview, AdminUser, BotStats, LobbyView, TrainJob, TrainResponse, TierInfo } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  const data = (await response.json().catch(() => ({}))) as T & { code?: string; message?: string };
  if (!response.ok) throw Object.assign(new Error(data.message ?? 'Lỗi không xác định'), { code: data.code });
  return data;
}

const post = <T,>(url: string, body: unknown) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  register: (username: string, password: string) => post<{ user: User }>('/api/auth/register', { username, password }),
  login: (username: string, password: string) => post<{ user: User }>('/api/auth/login', { username, password }),
  me: () => request<{ user: User }>('/api/auth/me'),
  guest: (name: string) => post<{ user: User }>('/api/auth/guest', { name }),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
  changePassword: (currentPassword: string, newPassword: string) =>
    post<{ ok: true }>('/api/auth/password', { currentPassword, newPassword }),
  tiers: () => request<Record<string, TierInfo>>('/api/tiers'),
  createLobby: (tier: string, vsBot = false, botDifficulty?: string) =>
    post<{ lobby: LobbyView }>('/api/lobbies', { tier, vsBot, botDifficulty }),
  joinLobby: (code: string) => request<{ lobby: LobbyView }>(`/api/lobbies/${code.toUpperCase()}`),
  bot: () => request<{ stats: BotStats }>('/api/bot'),
  profile: () => request<ProfileResponse>('/api/profile'),

  adminOverview: () => request<AdminOverview>('/api/admin/overview'),
  adminTrain: (payload: { games: number; tier: string; level: string; opponent: string }) =>
    post<TrainResponse>('/api/admin/train', payload),
  adminCancelTrain: () => post<{ cancelled: boolean; job: TrainJob | null }>('/api/admin/train/cancel', {}),
  adminResetBrain: () => post<{ stats: BotStats }>('/api/admin/bot/reset', {}),
  adminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  adminSetPassword: (id: string, password: string) =>
    post<{ ok: boolean; username: string }>(`/api/admin/users/${id}/password`, { password }),
};

export interface User {
  id: string;
  username: string;
  role: 'user' | 'admin';
  /** true = phiên khách, không có tài khoản/mật khẩu. */
  isGuest?: boolean;
}

export interface ProfileResponse {
  user: { id: string; username: string; role?: 'user' | 'admin'; isGuest?: boolean };
  stats: { total: number; wins: number; draws: number };
  matches: Array<{ matchId: string; tier: string; winnerId: string | null; reason: string | null; moves: number; startedAt: number | null }>;
}