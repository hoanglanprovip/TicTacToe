import { useMemo } from 'react';
import { CELL, cellOnEdge, stageTransform, type CameraController, type Viewport } from '../useCamera';
import { cellKey } from '../store';
import type { BoardCell, Cell, MatchState } from '../types';

interface Props {
  match: MatchState;
  myId: string | null;
  camera: CameraController;
  viewport: Viewport;
  premoveMode: boolean;
  onPick: (cell: Cell) => void;
  viewportRef: React.Ref<HTMLDivElement>;
  lastMove?: Cell | null;
}

const COMIC_SFX = ['BAM!', 'POW!', 'CHAT!', 'KENG!', 'XOET!', 'BUM!'];

const isWinning = (line: Cell[] | null, cell: Cell) =>
  !!line && line.some((c) => c.x === cell.x && c.y === cell.y);

/** Bàn cờ phong cách truyện tranh: lưới mực, hiệu ứng slam quân, sound-FX stickers. */
export function BoardView({
  match,
  myId,
  camera,
  viewport,
  premoveMode,
  onPick,
  viewportRef,
  lastMove,
}: Props) {
  const { rule, board, winningLine, players, moves } = match;
  const infinite = rule.boardType === 'infinite';
  const range = camera.visibleRange(6);

  const stoneMap = useMemo(() => {
    const map = new Map<string, BoardCell>();
    for (const cell of board) map.set(cellKey(cell), cell);
    return map;
  }, [board]);

  const opponentId = players.find((p) => p.userId !== myId)?.userId ?? null;
  const myPremove = players.find((p) => p.userId === myId)?.premove ?? [];
  const opponentPremove = players.find((p) => p.userId === opponentId)?.premove ?? [];

  const cells = useMemo(() => {
    if (!infinite) {
      const list: Cell[] = [];
      for (let y = 0; y < rule.size; y += 1) {
        for (let x = 0; x < rule.size; x += 1) list.push({ x, y });
      }
      return list;
    }

    const cellMap = new Map<string, Cell>();
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        cellMap.set(`${x},${y}`, { x, y });
      }
    }

    // Luôn giữ mọi quân đã đánh trên bàn trong danh sách render
    for (const st of board) {
      const k = cellKey(st);
      if (!cellMap.has(k)) cellMap.set(k, { x: st.x, y: st.y });
    }

    return Array.from(cellMap.values());
  }, [infinite, range.minX, range.maxX, range.minY, range.maxY, rule.size, board]);

  const { camera: view } = camera;
  const { zoom } = view;

  const myTurn = match.turn === myId && match.status === 'playing';

  // Last move sfx index
  const lastMoveSeq = moves.length > 0 ? moves[moves.length - 1]!.seq : 0;
  const sfxText = COMIC_SFX[lastMoveSeq % COMIC_SFX.length];

  return (
    <div className="board-viewport" ref={viewportRef}>
      <div className="board-stage" style={{ transform: stageTransform(view, viewport) }}>
        <div
          className={`board-grid ${infinite ? 'is-infinite' : 'is-finite'}`}
          style={infinite ? undefined : { width: rule.size * CELL, height: rule.size * CELL }}
        >
          {cells.map((cell) => {
            const key = cellKey(cell);
            const stone = stoneMap.get(key);
            const queueIndex = myPremove.findIndex((c) => cellKey(c) === key);
            const foeQueued = !stone && opponentPremove.some((c) => cellKey(c) === key);
            const winning = isWinning(winningLine, cell);
            const dimmed = !!stone && !winning;
            const isLast = lastMove && cell.x === lastMove.x && cell.y === lastMove.y;
            const isOrigin = infinite && cell.x === 0 && cell.y === 0;

            return (
              <button
                key={key}
                type="button"
                className={[
                  'cell',
                  winning ? 'cell-win' : '',
                  dimmed ? 'cell-dim' : '',
                  stone ? 'cell-occupied' : '',
                  isLast ? 'cell-latest' : '',
                  isOrigin ? 'cell-origin' : '',
                ]
                  .join(' ')
                  .trim()}
                style={{ left: cell.x * CELL, top: cell.y * CELL, width: CELL, height: CELL }}
                onClick={() => onPick(cell)}
                aria-label={`O ${cell.x},${cell.y}`}
              >
                {isOrigin && !stone && <span className="origin-badge">GOC 0,0</span>}
                {stone && (
                  <span className={`stone stone-${stone.symbol.toLowerCase()} stone-pop`}>
                    {stone.symbol}
                    {isLast && <span className="comic-sfx-sticker">{sfxText}</span>}
                  </span>
                )}
                {queueIndex >= 0 && (
                  <>
                    <span className="ghost ghost-mine" />
                    <span className="badge-queue">{queueIndex + 1}</span>
                  </>
                )}
                {foeQueued && <span className="ghost ghost-foe" />}
              </button>
            );
          })}
        </div>
      </div>

      {!myTurn && match.status === 'playing' && premoveMode && (
        <div className="board-hint">CHE DO DANH TRUOC: Bam o de xep nuoc (toi da 3)</div>
      )}
      {myTurn && rule.boardType === 'infinite' && !premoveMode && (
        <div className="board-hint">BAN DANH O BAT KY O TRONG NAO TREN LUOI!</div>
      )}
    </div>
  );
}

interface ArrowProps {
  cell: Cell;
  camera: CameraController;
  viewport: Viewport;
}

export function EdgeArrow({ cell, camera, viewport }: ArrowProps) {
  const { px, py, angle } = cellOnEdge(camera.camera, viewport, cell);

  return (
    <div
      className="edge-arrow"
      style={{ left: px, top: py, transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
    >
      <span className="edge-arrow-blink" />
      <span className="edge-arrow-label">NUOC MOI ({cell.x}, {cell.y})</span>
    </div>
  );
}
