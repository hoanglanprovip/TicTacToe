import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';
import { cellKey, useApp } from './store';
import { MAX_ZOOM, MIN_ZOOM, useCamera, useViewport } from './useCamera';
import { BoardView, EdgeArrow } from './components/BoardView';
import { Minimap } from './components/Minimap';
import { Hud, useLastMove } from './components/Hud';
import { Chat } from './components/Chat';
import { useTheme } from './useTheme';
import { Home } from './pages/Home';
import { AuthPage } from './pages/Auth';
import { LobbyPage } from './pages/Lobby';
import { ProfilePage } from './pages/Profile';
import { AdminPage } from './pages/Admin';
import type { Cell, ChatMessage, LobbyView, MatchState } from './types';

const readRoute = () => ({
  path: window.location.pathname,
  query: new URLSearchParams(window.location.search),
});

export function App() {
  const store = useApp();
  const { user, authChecked, route, lobby, match } = store;
  const { ref: viewportRef, size: viewport } = useViewport();
  const camera = useCamera(viewport);
  const lastMove = useLastMove(match);
  const [premoveMode, setPremoveMode] = useState(false);
  const isDraggingRef = useRef(false);
  const path = useMemo(() => readRoute().path, [route]);
  useTheme();

  const go = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    useApp.getState().navigate(to);
  }, []);

  useEffect(() => {
    const onPop = () => useApp.getState().navigate(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Chỉ kiểm tra phiên đăng nhập MỘT LẦN. Nếu chạy lại, các request 401 cũ sẽ bay tới
  // sau lúc đăng nhập/đăng ký thành công và xoá user, đẩy người dùng về trang login.
  useEffect(() => {
    let cancelled = false;
    void api.me()
      .then(({ user: u }) => { if (!cancelled) useApp.getState().setUser(u); })
      .catch(() => { if (!cancelled) useApp.getState().setUser(null); })
      .finally(() => { if (!cancelled) useApp.getState().setAuthChecked(true); });
    return () => { cancelled = true; };
  }, []);

  // Kết nối socket khi đã đăng nhập
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (socket.connected) return;
    socket.connect();
    return () => { /* giữ kết nối để vào phòng nhanh */ };
  }, [user]);

  // Lắng nghe sự kiện realtime — chỉ đăng ký MỘT LẦN.
  // Dùng useApp.getState() bên trong handler để luôn đọc state mới nhất.
  useEffect(() => {
    const socket = getSocket();
    const get = useApp.getState;

    const onLobbyState = (payload: LobbyView) => {
      get().setLobby(payload);
      if (payload.status === 'playing' || payload.status === 'finished' || payload.status === 'waiting') get().setCountdown(null);
    };
    const onLobbyError = (payload: { code: string; message: string }) => {
      get().toast(payload.message, 'error');
      if (payload.code === 'LOBBY_NOT_FOUND' || payload.code === 'LOBBY_IN_PROGRESS' || payload.code === 'LOBBY_FULL') {
        get().navigate('/');
      }
    };
    const onMatchState = (payload: MatchState) => get().setMatch(payload);
    const onMove = () => { /* state đầy đủ đi kèm nên không cần áp dụng cục bộ */ };
    const onMatchError = (payload: { error: string; message: string }) => get().toast(payload.message, 'error');
    const onPremove = (payload: { cancelled?: Cell }) => {
      if (payload.cancelled) {
        get().toast(`Nước đi trước tại (${payload.cancelled.x}, ${payload.cancelled.y}) đã bị đối thủ chiếm — nước đi bị huỷ.`, 'error');
      }
    };
    const onCountdown = ({ endsAt, ms }: { endsAt?: number; ms: number }) => get().setCountdown(endsAt ?? Date.now() + ms);
    const onRematchRequest = (payload: { requesterId: string; expiresAt: number; tier: string }) => get().setRematchRequest(payload);
    const onRematchResponse = (payload: { accepted: boolean; message?: string; requesterId?: string; responderId?: string }) => {
      get().setRematchRequest(null);
      if (!payload.accepted && payload.message && payload.requesterId === get().user?.id) get().toast(payload.message, 'info');
    };
    const onRematchExpired = () => {
      get().setRematchRequest(null);
      get().toast('Lời mời chơi lại đã hết hạn.', 'info');
    };
    const onEnd = ({ winnerId, reason }: { winnerId: string | null; reason: string }) => {
      const verb = { win: 'thắng!', draw: 'Hoà!', resign: 'đối thủ bỏ cuộc.', disconnect: 'đối thủ mất kết nối.', timeout: 'hết giờ.' }[reason] ?? 'kết thúc.';
      get().toast(winnerId === get().user?.id ? `Bạn ${verb}` : winnerId ? `Bạn thua — ${verb}` : verb, winnerId ? 'win' : 'info');
    };
    const onPresence = ({ userId, connected }: { userId: string; connected: boolean }) => get().setPresence(userId, connected);
    const onChatHistory = (messages: ChatMessage[]) => get().setChat(messages);
    const onChatMessage = (message: ChatMessage) => get().addChat(message);
    const onChatRejected = (payload: { reason: string }) => get().toast(payload.reason || 'Tin nhắn bị chặn.', 'error');
    const onChatModerated = (payload: { reason: string }) => get().toast(payload.reason || 'Một số từ đã được che.', 'info');
    const onKicked = () => { get().setKicked(true); get().toast('Bạn đã bị chủ phòng kick khỏi phòng.', 'error'); get().navigate('/'); };

    socket.on('lobby:state', onLobbyState);
    socket.on('lobby:error', onLobbyError);
    socket.on('lobby:presence', onPresence);
    socket.on('lobby:kicked', onKicked);
    socket.on('match:state', onMatchState);
    socket.on('match:move', onMove);
    socket.on('match:error', onMatchError);
    socket.on('match:premove', onPremove);
    socket.on('match:countdown', onCountdown);
    socket.on('match:rematch-request', onRematchRequest);
    socket.on('match:rematch-response', onRematchResponse);
    socket.on('match:rematch-expired', onRematchExpired);
    socket.on('match:end', onEnd);
    socket.on('chat:history', onChatHistory);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:rejected', onChatRejected);
    socket.on('chat:moderated', onChatModerated);

    return () => {
      socket.off('lobby:state', onLobbyState);
      socket.off('lobby:error', onLobbyError);
      socket.off('lobby:presence', onPresence);
      socket.off('lobby:kicked', onKicked);
      socket.off('match:state', onMatchState);
      socket.off('match:move', onMove);
      socket.off('match:error', onMatchError);
      socket.off('match:premove', onPremove);
      socket.off('match:countdown', onCountdown);
      socket.off('match:rematch-request', onRematchRequest);
      socket.off('match:rematch-response', onRematchResponse);
      socket.off('match:rematch-expired', onRematchExpired);
      socket.off('match:end', onEnd);
      socket.off('chat:history', onChatHistory);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:rejected', onChatRejected);
      socket.off('chat:moderated', onChatModerated);
    };
  }, []);

  // Camera luôn tự động bay theo nước đi mới nhất
  useEffect(() => {
    if (!lastMove) return;
    camera.flyTo(lastMove, 380);
  }, [lastMove, camera.flyTo]);

  // Center finite boards on their actual center so all 3×3 / 6×6 cells are visible.
  useEffect(() => {
    if (!match || match.status !== 'playing' || match.moves.length !== 0) return;
    camera.centerOn(match.rule.boardType === 'finite'
      ? { x: (match.rule.size - 1) / 2, y: (match.rule.size - 1) / 2 }
      : { x: 0, y: 0 });
  }, [match?.matchId, match?.status, match?.rule.boardType, match?.rule.size, camera.centerOn]);

  // Vào phòng khi URL là /lobby/CODE
  const lobbyCode = path.startsWith('/lobby/') ? path.slice('/lobby/'.length).toUpperCase() : null;
  useEffect(() => {
    if (!lobbyCode || !user) return;
    const socket = getSocket();
    const join = () => socket.emit('lobby:join', { code: lobbyCode });
    if (socket.connected) join();
    else socket.on('connect', join);
    return () => { socket.off('connect', join); };
  }, [lobbyCode, user]);

  const onPick = useCallback((cell: Cell) => {
    if (isDraggingRef.current) return;
    const socket = getSocket();
    const state = useApp.getState();
    const current = state.match;
    if (!current || !state.user) return;
    if (current.status !== 'playing') return;

    // Luôn đánh nước thật khi đang tới lượt. Các nước xếp trước không được chặn lượt đánh hiện tại.
    if (current.turn === state.user.id) {
      socket.emit('game:place', { x: cell.x, y: cell.y });
      return;
    }

    if (!current.premoveEnabled) {
      useApp.getState().toast('Chưa tới lượt bạn.', 'info');
      return;
    }
    if (!premoveMode) {
      useApp.getState().toast('Bật chế độ “Đánh trước” rồi chọn ô để xếp nước.', 'info');
      return;
    }
    const mine = current.players.find((p) => p.userId === state.user?.id)?.premove ?? [];
    const index = mine.findIndex((c) => cellKey(c) === cellKey(cell));
    if (index >= 0) {
      socket.emit('game:premove', { cells: mine.filter((_, i) => i !== index) });
      return;
    }
    if (mine.length >= 3) { useApp.getState().toast('Chỉ xếp tối đa 3 nước trước.', 'error'); return; }
    socket.emit('game:premove', { cells: [...mine, cell] });
  }, [premoveMode]);

  // Điều khiển bằng bàn phím
  const { centerOn, zoomBy, flyTo } = camera;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === '0') centerOn({ x: 0, y: 0 });
      if (e.key === 'f' || e.key === 'F') { if (lastMove) flyTo(lastMove, 350); }
      if (e.key === '+' || e.key === '=') zoomBy(1.2);
      if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
      if (e.key === ' ') { e.preventDefault(); setPremoveMode((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [centerOn, zoomBy, flyTo, lastMove]);

  // Kéo / zoom chuột trên bàn cờ
  const dragState = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, moved: false };
    isDraggingRef.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      isDraggingRef.current = true;
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    camera.panBy(dx, dy);
  };
  const onPointerUp = () => {
    dragState.current = null;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 4) return;
    camera.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  if (!authChecked) return <div className="loading">Đang tải…</div>;

  if (!user) {
    if (path === '/register') return <AuthPage mode="register" onDone={() => go('/')} />;
    if (path === '/guest') return <AuthPage mode="guest" onDone={() => go('/')} />;
    return <AuthPage mode="login" onDone={() => go('/')} />;
  }

  if (path === '/profile') return <ProfilePage />;
  // Khu vực quản trị chỉ dành cho tài khoản admin, tài khoản thường bị đưa về trang chủ.
  if (path === '/admin') return user.role === 'admin' ? <AdminPage /> : <Home />;
  if (lobbyCode) {
    return (
      <LobbyPage
        code={lobbyCode}
        countdown={store.countdown}
        renderBoard={
          <div
            className="board-shell"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <BoardView
              match={match!}
              myId={user.id}
              camera={camera}
              viewport={viewport}
              premoveMode={premoveMode}
              onPick={onPick}
              viewportRef={viewportRef}
              lastMove={lastMove}
            />
            {lastMove && !camera.isVisible(lastMove) && <EdgeArrow cell={lastMove} camera={camera} viewport={viewport} />}
            <CameraControls camera={camera} />
            <Minimap match={match!} camera={camera} viewport={viewport} onJump={(cell) => camera.flyTo(cell, 300)} />
          </div>
        }
        renderHud={match && <Hud match={match} myId={user.id} deadline={match.turnDeadline} premoveEnabled={match.premoveEnabled} />}
        renderChat={<Chat onSend={(text) => getSocket().emit('chat:send', { text })} />}
        premoveMode={premoveMode}
        setPremoveMode={setPremoveMode}
        camera={camera}
        lastMove={lastMove}
      />
    );
  }

  return <Home />;
}

function CameraControls({ camera }: { camera: ReturnType<typeof useCamera> }) {
  const zoom = camera.camera.zoom;
  return (
    <div className="camera-controls">
      <button type="button" onClick={() => camera.zoomBy(1.2)} title="Phóng to (+)">+</button>
      <button type="button" onClick={() => camera.zoomBy(1 / 1.2)} title="Thu nhỏ (−)">−</button>
      <button type="button" onClick={() => camera.centerOn({ x: 0, y: 0 })} title="Về giữa (0)">◎</button>
      <span className="zoom-label">{Math.round(zoom * 100)}%</span>
    </div>
  );
}

export { MIN_ZOOM, MAX_ZOOM };
