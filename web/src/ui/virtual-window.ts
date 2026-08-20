export const DEFAULT_OVERSCAN = 5;

export interface VirtualWindow {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export function computeWindow(
  total: number,
  scrollTop: number,
  viewportPx: number,
  rowPx: number,
  overscan: number,
): VirtualWindow {
  if (total === 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }

  const scroll = Math.max(0, scrollTop);
  const start = Math.min(
    Math.max(0, Math.floor(scroll / rowPx) - overscan),
    total,
  );
  const end = Math.min(
    total,
    Math.max(start, Math.ceil((scroll + viewportPx) / rowPx) + overscan),
  );
  const topPad = start * rowPx;
  const bottomPad = (total - end) * rowPx;

  return { start, end, topPad, bottomPad };
}
