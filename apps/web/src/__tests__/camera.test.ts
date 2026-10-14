import { describe, expect, it } from 'vitest';
import {
  CELL,
  cellOnEdge,
  cellToScreen,
  isCellVisible,
  stageTransform,
  visibleRangeOf,
  type Camera,
  type Viewport,
} from '../useCamera';

const VIEWPORT: Viewport = { width: 900, height: 560 };

/** Ô giữa màn hình chính là tâm khung nhìn — tránh lỗi bàn dồn vào một góc. */
function centerOf(camera: Camera, viewport: Viewport) {
  return cellToScreen(camera, viewport, camera.x, camera.y);
}

describe('stageTransform — căn giữa bàn theo khung nhìn', () => {
  it('đưa tâm camera vào đúng tâm khung nhìn', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 };
    const transform = stageTransform(camera, VIEWPORT);
    expect(transform).toBe(
      `translate(${VIEWPORT.width / 2}px, ${VIEWPORT.height / 2}px) scale(1) translate(${-0.5 * CELL}px, ${-0.5 * CELL}px)`,
    );
  });

  it('tâm ô luôn nằm ở giữa màn hình kể cả khi camera ở toạ độ xa', () => {
    for (const camera of [
      { x: 0, y: 0, zoom: 1 },
      { x: 42, y: -17, zoom: 1 },
      { x: -300, y: 250, zoom: 0.35 },
      { x: 7, y: 7, zoom: 2.5 },
    ] satisfies Camera[]) {
      const { px, py } = centerOf(camera, VIEWPORT);
      expect(px).toBeCloseTo(VIEWPORT.width / 2, 5);
      expect(py).toBeCloseTo(VIEWPORT.height / 2, 5);
    }
  });

  it('zoom không làm lệch tâm', () => {
    const { px } = centerOf({ x: 9, y: 9, zoom: 0.5 }, VIEWPORT);
    expect(px).toBeCloseTo(VIEWPORT.width / 2, 5);
  });
});

describe('visibleRangeOf — lưới phủ kín toàn màn hình', () => {
  /** Đổi toạ độ pixel trên màn hình sang chỉ số ô chứa điểm đó. */
  const cellAtPixel = (camera: Camera, viewport: Viewport, px: number, py: number) => ({
    ix: Math.floor(camera.x + (px - viewport.width / 2) / (CELL * camera.zoom)),
    iy: Math.floor(camera.y + (py - viewport.height / 2) / (CELL * camera.zoom)),
  });

  it('mọi góc màn hình đều có ô trong phạm vi render', () => {
    const camera: Camera = { x: 12, y: -5, zoom: 1 };
    const range = visibleRangeOf(camera, VIEWPORT, 6);

    const corners: Array<[number, number]> = [
      [0, 0],
      [VIEWPORT.width, 0],
      [0, VIEWPORT.height],
      [VIEWPORT.width, VIEWPORT.height],
      [VIEWPORT.width / 2, VIEWPORT.height / 2],
    ];
    for (const [px, py] of corners) {
      const { ix, iy } = cellAtPixel(camera, VIEWPORT, px, py);
      expect(range.minX).toBeLessThanOrEqual(ix);
      expect(range.maxX).toBeGreaterThanOrEqual(ix);
      expect(range.minY).toBeLessThanOrEqual(iy);
      expect(range.maxY).toBeGreaterThanOrEqual(iy);

      // Toạ độ world của ô có chỉ số k là (k + 0.5) — cùng hệ với stageTransform.
      const center = cellToScreen(camera, VIEWPORT, ix + 0.5, iy + 0.5);
      expect(center.px).toBeGreaterThanOrEqual(px - CELL / 2);
      expect(center.px).toBeLessThanOrEqual(px + CELL / 2);
      expect(center.py).toBeGreaterThanOrEqual(py - CELL / 2);
      expect(center.py).toBeLessThanOrEqual(py + CELL / 2);
    }
  });

  it('bao phủ đủ số ô nhìn thấy ở mọi mức zoom', () => {
    for (const zoom of [0.3, 0.5, 1, 1.5, 2.5]) {
      const camera: Camera = { x: -3, y: 8, zoom };
      const range = visibleRangeOf(camera, VIEWPORT, 0);
      const spanX = range.maxX - range.minX + 1;
      const spanY = range.maxY - range.minY + 1;
      const neededX = Math.ceil(VIEWPORT.width / (CELL * zoom)) + 1;
      const neededY = Math.ceil(VIEWPORT.height / (CELL * zoom)) + 1;
      expect(spanX).toBeGreaterThanOrEqual(neededX);
      expect(spanY).toBeGreaterThanOrEqual(neededY);
    }
  });

  it('bàn ở toạ độ xa vẫn được render quanh camera', () => {
    const camera: Camera = { x: 500, y: -500, zoom: 1 };
    const range = visibleRangeOf(camera, VIEWPORT, 6);
    expect(range.minX).toBeLessThanOrEqual(500);
    expect(range.maxX).toBeGreaterThanOrEqual(500);
    expect(range.minY).toBeLessThanOrEqual(-500);
    expect(range.maxY).toBeGreaterThanOrEqual(-500);
  });

  it('không vỡ toán khi khung nhìn chưa đo được', () => {
    const range = visibleRangeOf({ x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }, 5);
    expect(Number.isFinite(range.minX)).toBe(true);
    expect(Number.isFinite(range.maxY)).toBe(true);
  });
});

describe('isCellVisible / cellOnEdge', () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };

  it('ô trong khung nhìn được coi là hiển thị', () => {
    expect(isCellVisible(camera, VIEWPORT, { x: 0, y: 0 })).toBe(true);
    expect(isCellVisible(camera, VIEWPORT, { x: 5, y: -3 })).toBe(true);
  });

  it('ô ngoài khung nhìn không phải là hiển thị', () => {
    expect(isCellVisible(camera, VIEWPORT, { x: 100, y: 100 })).toBe(false);
  });

  it('mũi tên biên luôn nằm trong khung nhìn', () => {
    const far = cellOnEdge({ x: 0, y: 0, zoom: 1 }, VIEWPORT, { x: 40, y: 0 });
    expect(far.px).toBeLessThanOrEqual(VIEWPORT.width + 1);
    expect(far.px).toBeGreaterThanOrEqual(-1);
    expect(far.angle).toBeCloseTo(0, 5);

    const up = cellOnEdge({ x: 0, y: 0, zoom: 1 }, VIEWPORT, { x: 0, y: -30 });
    expect(up.angle).toBeCloseTo(-90, 5);
  });
});