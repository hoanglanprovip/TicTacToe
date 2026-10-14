import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Cell } from './types';

export const CELL = 64;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export interface CellRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Nửa kích thước khung nhìn tính theo đơn vị ô (luôn dương). */
export function halfSpan(viewport: Viewport, zoom: number) {
  const safeW = Math.max(viewport.width, 1);
  const safeH = Math.max(viewport.height, 1);
  return {
    halfW: safeW / 2 / (CELL * zoom),
    halfH: safeH / 2 / (CELL * zoom),
  };
}

/**
 * Phạm vi ô cần render để lưới PHỦ KÍN khung nhìn.
 * Đây là hàm thuần nên test được độc lập.
 */
export function visibleRangeOf(camera: Camera, viewport: Viewport, pad = 5): CellRange {
  const { x, y, zoom } = camera;
  const { halfW, halfH } = halfSpan(viewport, zoom);
  return {
    minX: Math.floor(x - halfW) - pad,
    maxX: Math.ceil(x + halfW) + pad,
    minY: Math.floor(y - halfH) - pad,
    maxY: Math.ceil(y + halfH) + pad,
  };
}

/** CSS transform đưa tâm camera vào đúng tâm khung nhìn. */
export function stageTransform(camera: Camera, viewport: Viewport): string {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  return `translate(${cx}px, ${cy}px) scale(${camera.zoom}) translate(${-(camera.x + 0.5) * CELL}px, ${-(camera.y + 0.5) * CELL}px)`;
}

/** Toạ độ màn hình (px) của tâm ô (x, y). */
export function cellToScreen(camera: Camera, viewport: Viewport, x: number, y: number) {
  return {
    px: viewport.width / 2 + (x - camera.x) * CELL * camera.zoom,
    py: viewport.height / 2 + (y - camera.y) * CELL * camera.zoom,
  };
}

export function isCellVisible(camera: Camera, viewport: Viewport, target: Cell): boolean {
  const { halfW, halfH } = halfSpan(viewport, camera.zoom);
  return Math.abs(target.x - camera.x) <= halfW && Math.abs(target.y - camera.y) <= halfH;
}

/** Toạ độ màn hình của toạ độ thế giới đã vượt ra ngoài khung nhìn (mũi tên biên). */
export function cellOnEdge(camera: Camera, viewport: Viewport, target: Cell) {
  const dx = target.x - camera.x;
  const dy = target.y - camera.y;
  const { halfW, halfH } = halfSpan(viewport, camera.zoom);
  const ratio = Math.min(halfW / (Math.abs(dx) || 0.001), halfH / (Math.abs(dy) || 0.001));
  return {
    px: viewport.width / 2 + dx * ratio * CELL * camera.zoom,
    py: viewport.height / 2 + dy * ratio * CELL * camera.zoom,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/**
 * Đo khung nhìn bàn cờ tự động.
 * QUAN TRỌNG: chỉ cập nhật state khi kích thước thực sự thay đổi, nếu không sẽ
 * rơi vào vòng lặp render vô hạn và làm sập toàn bộ giao diện trong game.
 */
export function useViewport() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Viewport>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const width = Math.round(node.getBoundingClientRect().width);
      const height = Math.round(node.getBoundingClientRect().height);
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  // Luôn trả về kích thước dùng được (không bao giờ 0) để bàn cờ luôn được căn giữa.
  const safe = useMemo<Viewport>(() => {
    const fallbackW = typeof window === 'undefined' ? 960 : Math.max(320, window.innerWidth - 380);
    const fallbackH = typeof window === 'undefined' ? 600 : Math.max(320, Math.round(window.innerHeight * 0.68));
    return {
      width: size.width > 0 ? size.width : fallbackW,
      height: size.height > 0 ? size.height : fallbackH,
    };
  }, [size.width, size.height]);

  return { ref, size: safe };
}

/**
 * Điều khiển camera theo toạ độ ô (x, y) thế giới.
 * Tâm khung nhìn luôn tương ứng với vị trí (camera.x, camera.y).
 */
export function useCamera(viewport: Viewport) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const rafRef = useRef<number | null>(null);
  cameraRef.current = camera;

  const cancelTween = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const flyTo = useCallback((target: Cell, duration = 380) => {
    cancelTween();
    const from = { ...cameraRef.current };
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      const e = easeOutCubic(t);

      setCamera((prev) => ({
        ...prev,
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
      }));

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, []);

  const centerOn = useCallback((target: Cell) => {
    cancelTween();
    setCamera((c) => ({ ...c, x: target.x, y: target.y }));
  }, []);

  const zoomBy = useCallback((factor: number, anchor?: Cell) => {
    setCamera((c) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((c.zoom * factor).toFixed(2))));
      if (zoom === c.zoom || !anchor) return { ...c, zoom };
      const k = zoom / c.zoom;
      return { zoom, x: anchor.x + (c.x - anchor.x) / k, y: anchor.y + (c.y - anchor.y) / k };
    });
  }, []);

  const panBy = useCallback((dxPixels: number, dyPixels: number) => {
    cancelTween();
    setCamera((c) => ({
      ...c,
      x: c.x - dxPixels / (CELL * c.zoom),
      y: c.y - dyPixels / (CELL * c.zoom),
    }));
  }, []);

  /** Phạm vi ô nhìn thấy bao phủ toàn bộ khung nhìn + lề đệm rộng để lưới luôn kín màn hình. */
  const visibleRange = useCallback(
    (pad = 5) => visibleRangeOf(cameraRef.current, viewport, pad),
    [viewport],
  );

  /** Kiểm tra ô có nằm trong khung nhìn hiển thị hay không. */
  const isVisible = useCallback(
    (target: Cell) => isCellVisible(cameraRef.current, viewport, target),
    [viewport],
  );

  useEffect(() => cancelTween, []);

  return { camera, setCamera, flyTo, centerOn, zoomBy, panBy, visibleRange, isVisible, cancelTween };
}

export type CameraController = ReturnType<typeof useCamera>;
