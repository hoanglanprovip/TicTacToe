import { useState } from 'react';
import { useApp } from '../store';
import { api } from '../api';
import { getSocket } from '../socket';
import { ThemePicker } from '../useTheme';

interface Props {
  mode: 'login' | 'register' | 'guest';
  onDone: () => void;
}

/** Trang đăng nhập/đăng ký phong cách Comic Pass. */
export function AuthPage({ mode, onDone }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const store = useApp();

  const next = new URLSearchParams(window.location.search).get('next') ?? '/';
  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    store.navigate(to);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password);
      store.setUser(user);
      const socket = getSocket();
      if (!socket.connected) {
        socket.connect();
        socket.once('connect', () => {
          if (next.startsWith('/lobby/')) socket.emit('lobby:join', { code: next.slice(7).toUpperCase() });
        });
      } else if (next.startsWith('/lobby/')) {
        socket.emit('lobby:join', { code: next.slice(7).toUpperCase() });
      }
      navigate(next);
      onDone();
    } catch (err) {
      setError((err as Error).message || 'Thất bại. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  /** Vào chơi ngay với tên do người chơi tự nhập — không cần tài khoản. */
  const playAsGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api.guest(username);
      store.setUser(user);
      const socket = getSocket();
      const joinLobby = () => {
        if (next.startsWith('/lobby/')) socket.emit('lobby:join', { code: next.slice(7).toUpperCase() });
      };
      if (!socket.connected) {
        socket.connect();
        socket.once('connect', joinLobby);
      } else {
        joinLobby();
      }
      navigate(next);
      onDone();
    } catch (err) {
      setError((err as Error).message || 'Không tạo được phiên khách.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page auth">
      <form className="card" onSubmit={mode === 'guest' ? playAsGuest : submit}>
        <div className="card-tape" />
        <div className="auth-theme">
          <ThemePicker />
        </div>
        <h1>
          <span>{mode === 'login' ? 'DANG NHAP' : mode === 'register' ? 'TAO TAI KHOAN' : 'VAO CHOI NGAY'}</span>
        </h1>
        {next.startsWith('/lobby/') && (
          <div className="notice" style={{ padding: '8px 12px', fontSize: '13px' }}>
            <span>Đăng nhập để vào thẳng phòng thách đấu bạn được mời!</span>
          </div>
        )}
        <label>
          {mode === 'guest' ? 'TEN HIEN THI (2-16 KY TU)' : 'TEN DAU THU (USERNAME)'}
          <input
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            placeholder={mode === 'guest' ? 'vd: Ban Minh' : 'vd: sieunhan_caro'}
          />
        </label>
        {mode !== 'guest' && (
          <label>
            MAT KHAU
            <input
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự"
            />
          </label>
        )}
        {mode === 'guest' && (
          <p className="hint">
            Không cần mat khau. Phien khach tu hieu sau 12 gio va khong luu thanh tich.
            Muon giu lai thi cua minh? <a href="/register">Dang ky tai khoan</a>.
          </p>
        )}
        {error && <div className="error">{error}</div>}
        <button className="primary big" type="submit" disabled={busy}>
          {busy
            ? 'DANG XU LY...'
            : mode === 'login'
            ? 'VAO TRAN DAU'
            : mode === 'register'
            ? 'DANG KY TAI KHOAN'
            : 'VAO CHOI LUON'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => navigate(mode === 'login' ? '/register' : mode === 'guest' ? '/' : '/')}
        >
          {mode === 'login'
            ? 'Chưa có tài khoản? Đăng ký ngay'
            : mode === 'guest'
            ? 'Quay lại đăng nhập tài khoản'
            : 'Đã có tài khoản? Đăng nhập tại đây'}
        </button>
        {mode === 'login' && (
          <button type="button" className="link guest-link" onClick={() => navigate('/guest')}>
            Không muốn tạo tài khoản? Vào chơi ngay với tên bất kỳ
          </button>
        )}
      </form>
    </div>
  );
}
