import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { ThemePicker } from '../useTheme';
import type { BotStats, TierInfo } from '../types';

const TIER_ORDER = ['classic', 'big', 'infinity'];
const DIFFICULTY_VI: Record<string, string> = { easy: 'DE', normal: 'VUA', hard: 'KHO' };

const TIER_BADGES: Record<string, string> = {
  classic: 'THANG 3',
  big: 'THANG 4',
  infinity: 'THANG 5',
};

export function Home() {
  const { user, lobby, toast } = useApp();
  const [tiers, setTiers] = useState<Record<string, TierInfo>>({});
  const [bot, setBot] = useState<BotStats | null>(null);
  const [selected, setSelected] = useState('classic');
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    void api.tiers().then(setTiers).catch(() => toast('Không tải được danh sách chế độ.', 'error'));
    // Thông tin não bot chỉ hiện với tài khoản admin, tài khoản thường không thấy.
    if (isAdmin) void api.bot().then((r) => setBot(r.stats)).catch(() => undefined);
  }, [toast, isAdmin]);

  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    useApp.getState().navigate(to);
  };

  const create = async (vsBot: boolean) => {
    setBusy(true);
    try {
      const { lobby: created } = await api.createLobby(selected, vsBot, difficulty);
      navigate(`/lobby/${created.code}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 6) return toast('Mã phòng gồm 6 ký tự.', 'error');
    navigate(`/lobby/${code}`);
  };

  return (
    <div className="page home">
      <header className="topbar">
        <div className="brand">
          <span>TIC TAC TOE</span>
          <span className="brand-badge">COMIC EDITION</span>
        </div>
        <div className="topbar-right">
          <ThemePicker />
          {user?.isGuest && <span className="guest-badge">KHACH</span>}
          <span className="who">DAU THU: {user?.username}</span>
          {isAdmin && (
            <button type="button" onClick={() => navigate('/admin')}>
              QUAN TRI
            </button>
          )}
          <button type="button" onClick={() => navigate('/profile')}>
            HO SO
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              void api.logout().finally(() => {
                useApp.getState().setUser(null);
                navigate('/');
              })
            }
          >
            DANG XUAT
          </button>
        </div>
      </header>

      {lobby && (
        <div className="notice">
          <span>
            BAN DANG O PHONG <b>{lobby.code}</b>!
          </span>
          <button type="button" onClick={() => navigate(`/lobby/${lobby.code}`)}>
            QUAY LAI PHONG
          </button>
        </div>
      )}

      {/* Chơi với máy */}
      <section className="card">
        <div className="card-tape" />
        <h2>
          <span>DAU VOI MAY (BOT)</span>
          <span className="card-badge">CHOI NGAY</span>
        </h2>
        <p className="hint">Chơi đơn lập tức! Chọn chiến trường, chọn độ khó rồi xuất trận.</p>

        <div className="tier-grid">
          {TIER_ORDER.map((id) => {
            const tier = tiers[id];
            if (!tier) return null;
            return (
              <button
                key={id}
                type="button"
                className={`tier ${selected === id ? 'is-selected' : ''}`}
                onClick={() => setSelected(id)}
              >
                <span className="tier-badge">{TIER_BADGES[id] ?? 'CHIEN'}</span>
                <b>{tier.label}</b>
                <span>{tier.description}</span>
              </button>
            );
          })}
        </div>

        <div className="difficulty-row">
          <span>DO KHO:</span>
          {(['easy', 'normal', 'hard'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={difficulty === d ? 'chip is-selected' : 'chip'}
              onClick={() => setDifficulty(d)}
            >
              {DIFFICULTY_VI[d]}
            </button>
          ))}
        </div>

        {bot && isAdmin && (
          <p className="hint bot-brain">
            MAY DANG O <b>CAP {bot.level}</b> · DA HOC <b>{bot.lessons}</b> BAI · {bot.games} VAN (
            {bot.wins} THANG / {bot.losses} THUA) — XEM VA TRAIN THEM TRONG KHU VUC <b>QUAN TRI</b>.
          </p>
        )}

        <button type="button" className="primary big" disabled={busy} onClick={() => void create(true)}>
          XUAT TRAN DAU VOI MAY
        </button>
      </section>

      {/* Tạo phòng rủ bạn */}
      <section className="card">
        <h2>
          <span>TAO PHONG THACH DAU</span>
          <span className="card-badge">2 NGUOI</span>
        </h2>
        <p className="hint">Tạo phòng riêng, chia sẻ liên kết mời bạn bè cùng vào tranh tài.</p>

        <button type="button" className="big" disabled={busy} onClick={() => void create(false)}>
          TAO PHONG & LAY LINK MOI
        </button>
      </section>

      {/* Vào phòng bằng mã */}
      <section className="card">
        <h2>
          <span>VAO PHONG BANG MA</span>
        </h2>
        <p className="hint">Nhập mã phòng 6 ký tự để bước vào đấu trường.</p>
        <div className="join-row">
          <input
            value={joinCode}
            maxLength={6}
            placeholder="MA 6 KY TU"
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') join();
            }}
          />
          <button type="button" className="primary" onClick={join}>
            VAO PHONG
          </button>
        </div>
      </section>
    </div>
  );
}
