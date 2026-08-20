import { describe, expect, it } from "vitest";
import { computeWindow, DEFAULT_OVERSCAN } from "./virtual-window";

describe("computeWindow", () => {
  it("returns all zeros for an empty list", () => {
    expect(computeWindow(0, 0, 256, 44, DEFAULT_OVERSCAN)).toEqual({
      start: 0,
      end: 0,
      topPad: 0,
      bottomPad: 0,
    });
  });

  it("at scrollTop 0 starts at index 0 with overscan to the end", () => {
    const rowPx = 44;
    const viewportPx = 256;
    const overscan = 5;
    const win = computeWindow(100, 0, viewportPx, rowPx, overscan);
    expect(win.start).toBe(0);
    expect(win.end).toBe(Math.min(100, Math.ceil(viewportPx / rowPx) + overscan));
    expect(win.topPad).toBe(0);
    expect(win.bottomPad).toBe((100 - win.end) * rowPx);
  });

  it("mid-scroll window has correct padding", () => {
    const rowPx = 44;
    const viewportPx = 256;
    const overscan = 5;
    const scrollTop = 440;
    const total = 100;
    const win = computeWindow(total, scrollTop, viewportPx, rowPx, overscan);
    expect(win.start).toBe(Math.max(0, Math.floor(scrollTop / rowPx) - overscan));
    expect(win.end).toBe(
      Math.min(total, Math.ceil((scrollTop + viewportPx) / rowPx) + overscan),
    );
    expect(win.topPad).toBe(win.start * rowPx);
    expect(win.bottomPad).toBe((total - win.end) * rowPx);
  });

  it("end-of-list clamps end and bottomPad to zero", () => {
    const rowPx = 44;
    const viewportPx = 256;
    const overscan = 5;
    const total = 10;
    const scrollTop = 10_000;
    const win = computeWindow(total, scrollTop, viewportPx, rowPx, overscan);
    expect(win.end).toBe(total);
    expect(win.bottomPad).toBe(0);
  });

  it("treats negative scrollTop as zero", () => {
    const win = computeWindow(50, -100, 256, 44, 5);
    const atZero = computeWindow(50, 0, 256, 44, 5);
    expect(win).toEqual(atZero);
  });

  it("maintains height invariant across scroll positions", () => {
    const total = 200;
    const rowPx = 44;
    const viewportPx = 256;
    const overscan = 5;
    const maxScroll = total * rowPx;
    for (let scrollTop = 0; scrollTop <= maxScroll; scrollTop += 17) {
      const win = computeWindow(total, scrollTop, viewportPx, rowPx, overscan);
      const renderedHeight = win.topPad + win.bottomPad + (win.end - win.start) * rowPx;
      expect(renderedHeight).toBe(total * rowPx);
    }
  });
});
