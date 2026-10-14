import { useMemo } from 'react';
import { CELL, type CameraController, type Viewport } from '../useCamera';
import type { Cell, MatchState } from '../types';

const BOX = 176;
const PAD = 16;

interface Props {
  match: MatchState;
  camera: CameraController;
  viewport: Viewport;
  onJump: (cell: Cell) => void;
}

/** Bản đồ thu nhỏ phong cách Comic Radar. */
export function Minimap({ match, camera, viewport, onJump }: Props) {
  const bounds = useMemo(() => {
    const points = match.board.map((c) => ({ x: c.x, y: c.y }));
    if (match.rule.boardType === 'finite') {
      return { minX: -0.5, minY: -0.5, maxX: match.rule.size - 0.5, maxY: match.rule.size - 0.5 };
    }
    if (points.length === 0) return { minX: -3, minY: -3, maxX: 3, maxY: 3 };
    let minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (const p of points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 };
  }, [match.board, match.rule]);

  const { camera: cam } = camera;
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((BOX - PAD * 2) / spanX, (BOX - PAD * 2) / spanY);
  const offsetX = PAD + ((BOX - PAD * 2) - spanX * scale) / 2;
  const offsetY = PAD + ((BOX - PAD * 2) - spanY * scale) / 2;

  const toBox = (cx: number, cy: number) => ({
    left: offsetX + (cx - bounds.minX) * scale,
    top: offsetY + (cy - bounds.minY) * scale,
  });

  const halfW = viewport.width / 2 / (CELL * cam.zoom);
  const halfH = viewport.height / 2 / (CELL * cam.zoom);
  const view = { left: offsetX + (cam.x - halfW - bounds.minX) * scale, top: offsetY + (cam.y - halfH - bounds.minY) * scale };
  const viewW = Math.min(BOX, halfW * 2 * scale);
  const viewH = Math.min(BOX, halfH * 2 * scale);

  const toWorld = (event: React.MouseEvent<HTMLDivElement>): Cell => {
    const rect = event.currentTarget.getBoundingClientRect();
    const bx = event.clientX - rect.left;
    const by = event.clientY - rect.top;
    return {
      x: Math.round((bx - offsetX) / scale + bounds.minX),
      y: Math.round((by - offsetY) / scale + bounds.minY),
    };
  };

  return (
    <div className="minimap" style={{ width: BOX, height: BOX }} onClick={(e) => onJump(toWorld(e))} title="Radar: Bấm để nhảy tới vị trí">
      <div className="minimap-header">RADAR</div>
      <div className="minimap-box" style={{ left: offsetX, top: offsetY, width: spanX * scale, height: spanY * scale }} />
      {match.board.map((cell) => {
        const pos = toBox(cell.x, cell.y);
        const winning = match.winningLine?.some((c) => c.x === cell.x && c.y === cell.y);
        return (
          <span
            key={`${cell.x},${cell.y}`}
            className={`minimap-stone ${cell.symbol === 'X' ? 'mm-x' : 'mm-o'} ${winning ? 'mm-win' : ''}`}
            style={{ left: pos.left - 3.5, top: pos.top - 3.5 }}
          />
        );
      })}
      <div className="minimap-view" style={{ left: view.left, top: view.top, width: viewW, height: viewH }} />
    </div>
  );
}
