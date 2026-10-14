import { create } from 'zustand';
import type { Cell, ChatMessage, LobbyView, MatchState, User } from './types';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'win';
}

interface AppState {
  user: User | null;
  authChecked: boolean;
  route: string;
  lobby: LobbyView | null;
  match: MatchState | null;
  chat: ChatMessage[];
  toasts: Toast[];
  countdown: number | null;
  rematchRequest: { requesterId: string; expiresAt: number; tier: string } | null;
  presence: Record<string, boolean>;
  kicked: boolean;

  setUser: (user: User | null) => void;
  setAuthChecked: (v: boolean) => void;
  navigate: (route: string) => void;
  setLobby: (lobby: LobbyView | null) => void;
  setMatch: (match: MatchState | null) => void;
  addChat: (message: ChatMessage) => void;
  setChat: (messages: ChatMessage[]) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setCountdown: (value: number | null) => void;
  setRematchRequest: (value: AppState['rematchRequest']) => void;
  setPresence: (userId: string, connected: boolean) => void;
  setKicked: (v: boolean) => void;
}

let toastId = 0;

export const useApp = create<AppState>((set) => ({
  user: null,
  authChecked: false,
  route: '/',
  lobby: null,
  match: null,
  chat: [],
  toasts: [],
  countdown: null,
  rematchRequest: null,
  presence: {},
  kicked: false,

  setUser: (user) => set({ user }),
  setAuthChecked: (authChecked) => set({ authChecked }),
  navigate: (route) => set({ route }),
  setLobby: (lobby) => set({ lobby }),
  setMatch: (match) => set({ match }),
  addChat: (message) => set((s) => ({ chat: [...s.chat.slice(-99), message] })),
  setChat: (chat) => set({ chat }),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setCountdown: (countdown) => set({ countdown }),
  setRematchRequest: (rematchRequest) => set({ rematchRequest }),
  setPresence: (userId, connected) => set((s) => ({ presence: { ...s.presence, [userId]: connected } })),
  setKicked: (kicked) => set({ kicked }),
}));

export const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;
