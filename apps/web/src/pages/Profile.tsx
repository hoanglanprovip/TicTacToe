import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { ThemePicker } from '../useTheme';

const REASON_VI: Record<string, string> = {
  win: 'THANG OANH LIET',
  draw: 'HOA TRAN',
  resign: 'DOI THU XIN THUA',
  disconnect: 'MAT KET NOI',
  timeout: 'HET GIO',
};

export function ProfilePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.profile>> | null>(null);
  const toast = useApp((s) => s.toast);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    useApp.getState().navigate(to);
  };

  useEffect(() => {
    void api.profile().then(setData).catch(() => toast('Không tải được hồ sơ.', 'error'));
  }, [toast]);

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      toast('Đổi mật khẩu xong. Vui lòng đăng nhập lại.', 'win');
      useApp.getState().setUser(null);
      navigate('/');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span>HO SO DAU THU</span>
          <span className="brand-badge">STATS</span>
        </div>
        <div className="topbar-right">
          <ThemePicker />
          <button type="button" onClick={() => navigate('/')}>
            VE DAI SANH
          </button>
        </div>
      </header>

      {stats && (
        <section className="card">
          <div className="card-tape" />
          <h2>
            <span>DAU THU: {data!.user.username}</span>
          </h2>
          <div className="stat-row">
            <div className="stat-box">
              <b>{stats.total}</b>
              <span>TRAN DA DAU</span>
            </div>
            <div className="stat-box">
              <b style={{ color: 'var(--win)' }}>{stats.wins}</b>
              <span>CHIEN THANG</span>
            </div>
            <div className="stat-box">
              <b style={{ color: 'var(--muted)' }}>{stats.draws}</b>
              <span>HOA TRAN</span>
            </div>
            <div className="stat-box">
              <b style={{ color: 'var(--o)' }}>{stats.total - stats.wins - stats.draws}</b>
              <span>THAT BAI</span>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>
          <span>NHAT KY TRAN DAU</span>
        </h2>
        {!data && <p className="hint">Đang tải nhật ký…</p>}
        {data && data.matches.length === 0 && <p className="hint">Chưa có trận chiến nào. Hãy xuất trận ngay!</p>}
        {data?.matches.map((m, i) => (
          <div key={`${m.matchId}-${i}`} className="history-row">
            <span>
              {m.tier.toUpperCase()} · {m.moves} NUOC DI
            </span>
            <span className={m.winnerId === data.user.id ? 'win' : m.reason === 'draw' ? 'draw' : 'loss'}>
              {m.winnerId === data.user.id
                ? 'THANG'
                : m.reason === 'draw'
                ? 'HOA'
                : `THUA (${REASON_VI[m.reason ?? ''] ?? m.reason})`}
            </span>
          </div>
        ))}
      </section>

      {/* Đổi mật khẩu — chỉ dành cho tài khoản thật */}
      {data?.user?.isGuest ? (
        <section className="card">
          <div className="card-tape" />
          <h2>
            <span>PHIEN KHACH</span>
          </h2>
          <p className="hint">
            Ban dang choi voi ten hien thi, khong co mat khau nen khong doi duoc.
            Phien tu hieu sau 12 gio va khong luu thanh tich. Muon giu lai? <a href="/register">Dang ky tai khoan</a>.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="card-tape" />
          <h2>
            <span>DOI MAT KHAU</span>
          </h2>
          <form className="password-form" onSubmit={changePassword}>
            <label>
              MAT KHAU HIEN TAI
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label>
              MAT KHAU MOI (TOI THIEU 6 KY TU)
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button type="submit" className="primary big" disabled={saving}>
              {saving ? 'DANG LUU...' : 'LUU MAT KHAU MOI'}
            </button>
            <p className="hint">
              Sau khi đổi mật khẩu, mọi phiên đang đăng nhập (kể cả trên trình duyệt này) sẽ bị đăng xuất.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
