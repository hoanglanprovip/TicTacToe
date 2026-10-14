import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { ThemePicker } from '../useTheme';
import type { AdminOverview, AdminUser } from '../types';

const TIERS = [
  { id: 'classic', label: 'THANG 3' },
  { id: 'big', label: 'THANG 4' },
  { id: 'infinity', label: 'THANG 5' },
];

const LEVELS = [
  { id: 'easy', label: 'DE' },
  { id: 'normal', label: 'VUA' },
  { id: 'hard', label: 'KHO' },
];

const LEVEL_LABEL: Record<string, string> = { info: 'INFO', warn: 'CANH BAO', error: 'LOI', bot: 'BOT' };

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const duration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}p` : `${m}p ${sec % 60}s`;
};

/** Trang quản trị — chỉ tài khoản admin được mở (App chặn sẵn với acc thường). */
export function AdminPage() {
  const user = useApp((s) => s.user);
  const toast = useApp((s) => s.toast);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const [games, setGames] = useState(300);
  const [tier, setTier] = useState('classic');
  const [level, setLevel] = useState('hard');
  const [opponent, setOpponent] = useState('easy');

  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    useApp.getState().navigate(to);
  };

  const refresh = useCallback(async () => {
    try {
      const data = await api.adminOverview();
      setOverview(data);
      setDenied(false);
    } catch {
      setDenied(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api.adminUsers().then((r) => setUsers(r.users)).catch(() => setDenied(true));
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (denied) {
    return (
      <div className="page">
        <div className="card">
          <div className="card-tape" />
          <h2><span>KHONG CO QUYEN</span></h2>
          <p className="hint">Khu vuc quan tri chi danh cho tai khoan admin.</p>
          <button type="button" className="primary big" onClick={() => navigate('/')}>VE DAI SANH</button>
        </div>
      </div>
    );
  }

  const train = async () => {
    setBusy(true);
    try {
      const res = await api.adminTrain({ games, tier, level, opponent });
      if (res.alreadyRunning) toast('Đang có job train chạy dở.', 'info');
      else toast(`Đã bắt đầu train ${res.job.total} ván — server vẫn chơi bình thường.`, 'win');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelTrain = async () => {
    setBusy(true);
    try {
      await api.adminCancelTrain();
      toast('Đã huỷ job train.', 'info');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const resetBrain = async () => {
    if (!confirm('Xoa toan bo bai hoc cua bot?')) return;
    setBusy(true);
    try {
      await api.adminResetBrain();
      toast('Da xoa bao cao hoc cua bot.', 'info');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setPassword = async (target: AdminUser) => {
    const password = prompt(`Mat khau moi cho ${target.username} (it nhat 6 ky tu):`);
    if (!password) return;
    try {
      await api.adminSetPassword(target.id, password);
      toast(`Da dat lai mat khau cho ${target.username}.`, 'win');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const bot = overview?.bot;
  const sys = overview?.system;
  const job = overview?.training ?? null;

  return (
    <div className="page admin">
      <header className="topbar">
        <div className="brand">
          <span>QUAN TRI</span>
          <span className="brand-badge">ADMIN</span>
        </div>
        <div className="topbar-right">
          <ThemePicker />
          <span className="who">ADMIN: {user?.username}</span>
          <button type="button" onClick={() => navigate('/')}>DANH SACH</button>
          <button type="button" onClick={() => navigate('/profile')}>HO SO</button>
        </div>
      </header>

      {/* Não bot */}
      <section className="card">
        <div className="card-tape" />
        <h2><span>NAO BOT</span></h2>
        {bot && (
          <div className="stat-row">
            <div className="stat-box"><b>{bot.level}</b><span>CAP DO</span></div>
            <div className="stat-box"><b>{bot.lessons}</b><span>BAI HOC</span></div>
            <div className="stat-box"><b>{bot.games}</b><span>DA DAU</span></div>
            <div className="stat-box"><b style={{ color: 'var(--win)' }}>{bot.wins}</b><span>BOT THANG</span></div>
            <div className="stat-box"><b style={{ color: 'var(--o)' }}>{bot.losses}</b><span>BOT THUA</span></div>
            <div className="stat-box"><b style={{ color: 'var(--muted)' }}>{bot.draws}</b><span>HOA</span></div>
          </div>
        )}

        <div className="admin-train-row">
          <label>
            SO VAN
            <input
              type="number"
              min={1}
              max={sys?.maxTrainGames ?? 2000}
              value={games}
              onChange={(e) => setGames(Math.max(1, Math.min(sys?.maxTrainGames ?? 2000, Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            CHE DO
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>
            BOT CHINH
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {LEVELS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>
            DOI THU TU DANH
            <select value={opponent} onChange={(e) => setOpponent(e.target.value)}>
              {LEVELS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <button type="button" className="primary big" disabled={busy || job?.running} onClick={() => void train()}>
            {job?.running ? 'DANG TRAIN...' : 'BAT DAU TRAIN BOT'}
          </button>
          {job?.running && (
            <button type="button" className="danger" disabled={busy} onClick={() => void cancelTrain()}>
              HUY TRAIN
            </button>
          )}
          <button type="button" className="danger" disabled={busy || job?.running} onClick={() => void resetBrain()}>
            XOA BAI HOC
          </button>
        </div>

        {/* Tiến độ train — cập nhật mỗi 2 giây cùng nhật ký */}
        {job && (
          <div className="train-status">
            <div className="train-status-head">
              <b>
                {job.running
                  ? `DANG TRAIN: ${job.done}/${job.total} VAN (${job.tier}, bot ${job.level}, doi thu ${job.opponent})`
                  : job.error
                  ? `TRAIN LOI: ${job.error}`
                  : `TRAIN XONG ${job.done} VAN — cap do ${job.result?.stats.level ?? '?'}, ${job.result?.stats.lessons ?? '?'} bai hoc`}
              </b>
              {job.finishedAt && (
                <span>bat dau {timeOf(job.startedAt)} · ket thuc {timeOf(job.finishedAt)}</span>
              )}
            </div>
            <div className="train-bar">
              <div className="train-bar-fill" style={{ width: `${Math.min(100, (job.done / Math.max(1, job.total)) * 100)}%` }} />
            </div>
            {job.result && (
              <span className="hint">
                Ket qua: thang {job.result.results.win} · thua {job.result.results.loss} · hoa {job.result.results.draw} · {job.done} van
              </span>
            )}
          </div>
        )}

        <p className="hint">
          Train chay <b>nen tren worker rieng</b>: server van phan hoi binh thuong (van dang, phong, nhat ky deu chay),
          tien do cap nhat o day. Neu muon bot kho hon: tang <b>SO VAN</b> va chon <b>KHO</b> cho ca hai.
        </p>
      </section>

      {/* Hệ thống */}
      {sys && (
        <section className="card">
          <div className="card-tape" />
          <h2><span>HE THONG</span></h2>
          <div className="stat-row">
            <div className="stat-box"><b>{sys.users}</b><span>TAI KHOAN</span></div>
            <div className="stat-box"><b>{sys.lobbies}</b><span>PHONG</span></div>
            <div className="stat-box"><b>{sys.matches}</b><span>VAN DAU</span></div>
            <div className="stat-box"><b>{sys.sessions}</b><span>PHIEN</span></div>
            <div className="stat-box"><b>{duration(sys.uptimeSec)}</b><span>DA CHAY</span></div>
            <div className="stat-box"><b>{sys.nodeVersion}</b><span>NODE</span></div>
          </div>
        </section>
      )}

      {/* Tài khoản */}
      <section className="card">
        <div className="card-tape" />
        <h2><span>TAI KHOAN</span></h2>
        <div className="history-row" style={{ fontWeight: 900 }}>
          <span>TAI KHOAN</span><span>VAI TRO</span><span>VAO</span><span>THAO TAC</span>
        </div>
        {users.map((u) => (
          <div key={u.id} className="history-row">
            <span>{u.display}{u.isBot ? ' (MAY)' : ''}</span>
            <span className={u.role === 'admin' ? 'win' : ''}>{u.role === 'admin' ? 'ADMIN' : 'NGUOI CHOI'}</span>
            <span>{new Date(u.createdAt).toLocaleDateString('vi-VN')}</span>
            <span>
              <button type="button" onClick={() => void setPassword(u)}>DOI MAT KHAU</button>
            </span>
          </div>
        ))}
      </section>

      {/* Nhật ký */}
      <section className="card">
        <div className="card-tape" />
        <h2><span>NHAT KY HE THONG</span><span className="card-badge">TU DONG LAI 2S</span></h2>
        <div className="log-list">
          {overview?.logs.length === 0 && <p className="hint">Chua co su kien nao.</p>}
          {overview?.logs.map((entry) => (
            <div key={entry.id} className={`log-row log-${entry.level}`}>
              <span className="log-time">{timeOf(entry.at)}</span>
              <span className="log-scope">[{entry.scope}]</span>
              <span className="log-level">{LEVEL_LABEL[entry.level] ?? entry.level}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}