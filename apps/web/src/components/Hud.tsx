import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import type { MatchState } from '../types';

interface Props {
  match: MatchState;
  myId: string | null;
  deadline: number | null;
  premoveEnabled: boolean;
}

const REASON_VI: Record<string, string> = {
  win: 'CHIEN THANG TUYET DOI!',
  draw: 'BAT PHAN THANG BAI!',
  resign: 'DOI THU XIN THUA!',
  disconnect: 'DOI THU MAT KET NOI!',
  timeout: 'THANG THEO DIEM SO!',
};

const isBot = (userId: string) => userId.startsWith('bot:');

export function Hud({ match, myId, deadline, premoveEnabled }: Props) {
  const { presence, setPresence } = useApp();
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline) {
      setSeconds(null);
      return;
    }
    const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline]);

  const playerIds = match.players.map((p) => p.userId).join(',');
  useEffect(() => {
    for (const player of match.players) {
      if (isBot(player.userId)) continue;
      if (!(player.userId in presence)) setPresence(player.userId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerIds]);

  const p1 = match.players[0];
  const p2 = match.players[1];

  return (
    <div className="hud">
      <div className="hud-players">
        {p1 && (
          <PlayerBadge
            player={p1}
            isTurn={match.turn === p1.userId && match.status === 'playing'}
            isMe={p1.userId === myId}
            presence={presence}
          />
        )}
        {p2 && (
          <>
            <span className="vs-badge">VS</span>
            <PlayerBadge
              player={p2}
              isTurn={match.turn === p2.userId && match.status === 'playing'}
              isMe={p2.userId === myId}
              presence={presence}
            />
          </>
        )}
      </div>

      <div className="hud-status">
        {match.status === 'playing' && match.turn && (
          <span className={`hud-turn ${match.turn === myId ? 'mine' : ''}`}>
            {match.turn === myId
              ? 'DEN LUOT BAN!'
              : `LUOT: ${match.players.find((p) => p.userId === match.turn)?.username}`}
            {seconds !== null && ` (${seconds}s)`}
          </span>
        )}
        {match.status === 'finished' && (
          <span className="hud-result">
            {match.winnerId
              ? `${match.players.find((p) => p.userId === match.winnerId)?.username}: ${REASON_VI[match.reason ?? ''] ?? ''}`
              : 'HOA TRAN!'}
          </span>
        )}
      </div>
    </div>
  );
}

function PlayerBadge({
  player,
  isTurn,
  isMe,
  presence,
}: {
  player: MatchState['players'][number];
  isTurn: boolean;
  isMe: boolean;
  presence: Record<string, boolean>;
}) {
  const bot = isBot(player.userId);
  const connected = bot || presence[player.userId] !== false;
  return (
    <div className={`hud-player ${isTurn ? 'is-turn' : ''} ${isMe ? 'is-me' : ''} ${bot ? 'is-bot' : ''}`}>
      <span className={`hud-symbol sym-${player.symbol.toLowerCase()}`}>{player.symbol}</span>
      <div className="hud-player-info">
        <span className="hud-name">
          {bot ? '[MAY] ' : ''}{player.username} {isMe && <em>(BAN)</em>}
        </span>
        <span className="hud-meta">
          {player.stones} quân
          {player.premove.length > 0 && ` · ${player.premove.length} nước xếp`}
          {!connected && ' · [OFFLINE]'}
        </span>
      </div>
      {isTurn && <span className="hud-thinking">{bot ? 'DANG TINH TOAN...' : 'RA DON!'}</span>}
    </div>
  );
}

/** Ô vừa được đánh gần nhất — dùng để camera bay tới. */
export function useLastMove(match: MatchState | null) {
  const [cell, setCell] = useState<{ x: number; y: number } | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (!match || match.moves.length === 0) {
      setCell(null);
      lastSeq.current = 0;
      return;
    }
    const last = match.moves[match.moves.length - 1]!;
    if (last.seq === lastSeq.current) return;
    lastSeq.current = last.seq;
    setCell({ x: last.x, y: last.y });
  }, [match]);

  return cell;
}
