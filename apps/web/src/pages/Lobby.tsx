import { useEffect, useState } from 'react';
import { getSocket } from '../socket';
import { useApp } from '../store';
import { ThemePicker } from '../useTheme';
import type { CameraController } from '../useCamera';
import type { Cell } from '../types';

interface Props {
  code: string;
  countdown: number | null;
  renderBoard: React.ReactNode;
  renderHud: React.ReactNode;
  renderChat: React.ReactNode;
  premoveMode: boolean;
  setPremoveMode: (v: boolean) => void;
  camera: CameraController;
  lastMove: Cell | null;
}

const TIERS = [
  { id: 'classic', label: 'THANG 3' },
  { id: 'big', label: 'THANG 4' },
  { id: 'infinity', label: 'THANG 5' },
];

const DIFFICULTY_VI: Record<string, string> = { easy: 'De', normal: 'Vua', hard: 'Kho' };

export function LobbyPage({
  code,
  countdown,
  renderBoard,
  renderHud,
  renderChat,
  premoveMode,
  setPremoveMode,
  camera,
  lastMove,
}: Props) {
  const { lobby, match, user, toast, presence, kicked, rematchRequest } = useApp();
  const [copied, setCopied] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [rematchTier, setRematchTier] = useState('classic');

  useEffect(() => {
    if (kicked) return;
  }, [kicked]);

  useEffect(() => {
    if (countdown === null) {
      setCountdownSeconds(0);
      return;
    }
    const update = () => setCountdownSeconds(Math.max(0, Math.ceil((countdown - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (lobby) setRematchTier(lobby.tier);
  }, [lobby?.code, lobby?.tier, match?.matchId]);

  if (!lobby) return <div className="loading">DANG VAO PHONG {code}...</div>;

  const isHost = lobby.hostId === user?.id;
  const myId = user?.id;
  const me = match?.players.find((p) => p.userId === myId) ?? lobby.members.find((m) => m.userId === myId);
  const inviteUrl = `${window.location.origin}/lobby/${lobby.code}`;
  const hasBot = lobby.members.some((m) => m.isBot);
  const humans = lobby.members.filter((m) => !m.isBot).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(`Không copy được, hãy tự copy: ${inviteUrl}`, 'info');
    }
  };

  const emit = (event: string, payload?: unknown) => getSocket().emit(event, payload);
  const canStart = lobby.members.length >= 2 && isHost && lobby.status === 'waiting';
  const finished = match?.status === 'finished';

  const m1 = lobby.members[0];
  const m2 = lobby.members[1];

  const nextFirstName = lobby.nextFirstId
    ? lobby.members.find((m) => m.userId === lobby.nextFirstId)?.username ?? null
    : null;

  return (
    <div className="page lobby">
      <header className="topbar">
        <div className="brand">
          <span>PHONG DAU</span>
          <span className="brand-badge">#{lobby.code}</span>
        </div>
        <div className="topbar-right">
          <ThemePicker />
          <span className="who">{me ? `BAN LA QUAN ${me.symbol}` : ''}</span>
          <button
            type="button"
            className="danger"
            onClick={() => {
              getSocket().emit('lobby:leave');
              window.history.pushState({}, '', '/');
              useApp.getState().navigate('/');
              useApp.getState().setLobby(null);
              useApp.getState().setMatch(null);
            }}
          >
            ROI PHONG
          </button>
        </div>
      </header>

      {/* Phòng chờ */}
      {lobby.status === 'waiting' && (
        <div className="lobby-bar card">
          <div className="card-tape" />

          {!hasBot && (
            <div className="invite">
              <span className="invite-label">LINK MOI THACH DAU (NGUOI CHOI PHAI DANG NHAP):</span>
              <div className="invite-row">
                <input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="primary" onClick={() => void copy()}>
                  {copied ? 'DA COPY' : 'COPY LINK'}
                </button>
              </div>
            </div>
          )}

          {/* Matchup Banner */}
          <div className="players-matchup">
            {m1 && (
              <div className={`player-card ${m1.isBot ? 'is-bot' : ''}`}>
                <span className={`hud-symbol sym-${m1.symbol.toLowerCase()}`}>{m1.symbol}</span>
                <div className="player-card-info">
                  <span className="player-card-name">
                    {m1.isBot ? 'MAY' : m1.username} {m1.userId === myId && '(BAN)'}
                  </span>
                  <span className="player-card-status">
                    {m1.isBot ? `DO KHO: ${DIFFICULTY_VI[lobby.botDifficulty]}` : 'SAN SANG'}
                  </span>
                </div>
              </div>
            )}

            <span className="vs-badge">VS</span>

            {m2 ? (
              <div className={`player-card ${m2.isBot ? 'is-bot' : ''}`}>
                <span className={`hud-symbol sym-${m2.symbol.toLowerCase()}`}>{m2.symbol}</span>
                <div className="player-card-info">
                  <span className="player-card-name">
                    {m2.isBot ? 'MAY' : m2.username} {m2.userId === myId && '(BAN)'}
                  </span>
                  <span className="player-card-status">
                    {m2.isBot ? `DO KHO: ${DIFFICULTY_VI[lobby.botDifficulty]}` : 'SAN SANG'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="waiting-slot-card">DANG CHO DOI THU VAO PHONG...</div>
            )}
          </div>

          {/* Cài đặt phòng (chỉ Host) */}
          {isHost && (
            <div className="settings">
              <label>
                CHON CHE DO THI DAU
                <select value={lobby.tier} onChange={(e) => emit('lobby:update', { tier: e.target.value })}>
                  {TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="setting-row">
                <span className="setting-label">DOI THU:</span>
                {hasBot ? (
                  <>
                    <select
                      value={lobby.botDifficulty}
                      onChange={(e) => emit('lobby:addBot', { difficulty: e.target.value })}
                    >
                      <option value="easy">Máy — Dễ</option>
                      <option value="normal">Máy — Vừa</option>
                      <option value="hard">Máy — Khó</option>
                    </select>
                    <button type="button" onClick={() => emit('lobby:removeBot')}>
                      GO MAY
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={humans >= 2}
                    onClick={() => emit('lobby:addBot', { difficulty: lobby.botDifficulty })}
                  >
                    THEM MAY VAO DAU
                  </button>
                )}
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={lobby.premoveEnabled}
                  onChange={(e) => emit('lobby:update', { premoveEnabled: e.target.checked })}
                />
                BAT CHE DO DANH TRUOC (PRE-MOVE)
              </label>
            </div>
          )}

          {isHost ? (
            <button type="button" className="primary big" disabled={!canStart} onClick={() => emit('lobby:start')}>
              {canStart ? 'BAT DAU VAN DAU' : 'CAN DU 2 NGUOI DE BAT DAU'}
            </button>
          ) : (
            <p className="hint">Dang cho chu phong bat dau...</p>
          )}

          {/* Sau mỗi ván, người thua sẽ được đi trước ván sau */}
          {nextFirstName && (
            <p className="hint next-first-hint">
              VAN SAU: <b>{nextFirstName}</b> DI TRUOC (NGUOI THUA VAN TRUOC DUOC DI TRUOC).
            </p>
          )}
        </div>
      )}

      {/* Đếm ngược vào ván */}
      {countdown !== null && lobby.status === 'countdown' && (
        <div className="countdown-overlay">
          <div className="countdown-sunburst" />
          <div className="countdown-badge">{countdownSeconds}</div>
          <small>
            {lobby.status === 'countdown' && match?.status === 'finished'
              ? 'CHUAN BI TAI DAU...'
              : 'CHUAN BI XUAT TRAN...'}
          </small>
        </div>
      )}

      {/* Khu vực trận đấu */}
      {match && (
        <div className="play-area">
          {renderHud}
          {renderBoard}
          <div className="play-side">
            <div className="tool-row">
              {match.premoveEnabled && (
                <button
                  type="button"
                  className={premoveMode ? 'toggle is-on' : 'toggle'}
                  onClick={() => setPremoveMode(!premoveMode)}
                  title="Phím Cách"
                >
                  {premoveMode ? 'DANG XEP TRUOC' : 'DANH TRUOC (SPACE)'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  camera.cancelTween();
                  setPremoveMode(false);
                }}
              >
                BO XEP
              </button>
              <button type="button" onClick={() => lastMove && camera.flyTo(lastMove)} disabled={!lastMove}>
                NUOC CUOI
              </button>
              {match.status === 'playing' && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (confirm('Bạn chắc chắn muốn đầu hàng ván này?')) emit('game:resign');
                  }}
                >
                  XIN THUA
                </button>
              )}
            </div>

            {/* Bảng kết thúc ván */}
            {finished && (
              <div className="result-card card">
                <div className="card-tape" />
                <h3>{match.winnerId === myId ? 'CHIEN THANG!' : match.winnerId ? 'THAT BAI!' : 'BAT PHAN THANG BAI'}</h3>
                <p>{match.reason === 'win' ? 'Đủ điều kiện liên kết quân chiến thắng!' : match.reason}</p>

                {nextFirstName && (
                  <p className="hint next-first-hint">
                    VAN SAU <b>{nextFirstName}</b> SE DI TRUOC — NGUOI THUA VAN TRUOC DUOC DI TRUOC.
                  </p>
                )}

                {!rematchRequest && lobby.status === 'finished' && lobby.members.length === 2 && (
                  <div className="rematch-options">
                    <b>CHON CHE DO CHO VAN TIEP THEO:</b>
                    <select
                      value={rematchTier}
                      onChange={(e) => setRematchTier(e.target.value)}
                      aria-label="Chế độ chơi lại"
                    >
                      {TIERS.map((tier) => (
                        <option key={tier.id} value={tier.id}>
                          {tier.label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="primary big" onClick={() => emit('lobby:rematch:request', { tier: rematchTier })}>
                      {hasBot ? 'TAI DAU VOI MAY' : 'MOI TAI DAU'}
                    </button>
                  </div>
                )}

                {rematchRequest && (
                  <div className="rematch-options" aria-live="polite">
                    {rematchRequest.requesterId === myId ? (
                      <>
                        <b>DA MOI TAI DAU — {TIERS.find((t) => t.id === rematchRequest.tier)?.label ?? rematchRequest.tier}</b>
                        <span>Dang cho doi thu chap nhan hoac tu choi...</span>
                      </>
                    ) : (
                      <>
                        <b>DOI THU MUON TAI DAU</b>
                        <span>Chế độ: {TIERS.find((t) => t.id === rematchRequest.tier)?.label ?? rematchRequest.tier}</span>
                        <div className="rematch-actions">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => emit('lobby:rematch:respond', { accept: true })}
                          >
                            DONG Y TAI DAU
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => emit('lobby:rematch:respond', { accept: false })}
                          >
                            TU CHOI
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {renderChat}
          </div>
        </div>
      )}
    </div>
  );
}
