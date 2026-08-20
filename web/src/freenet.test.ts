import { describe, expect, it, vi } from "vitest";
import { UpdateDataType, type UpdateNotification } from "@freenetorg/freenet-stdlib";
import { notificationToEvent } from "./freenet";

function makeNotification(
  keyId: string,
  updateDataType: UpdateDataType,
  updateData: { state?: number[]; delta?: number[] } | null,
): UpdateNotification {
  return {
    key: { encode: () => keyId },
    update: updateData === null ? null : { updateDataType, updateData },
  } as unknown as UpdateNotification;
}

describe("notificationToEvent", () => {
  it("maps StateUpdate to kind state", () => {
    const ev = notificationToEvent(
      makeNotification("abc", UpdateDataType.StateUpdate, { state: [1, 2, 3] }),
    );
    expect(ev).toEqual({
      keyId: "abc",
      kind: "state",
      bytes: Uint8Array.from([1, 2, 3]),
      receivedAt: expect.any(Number),
    });
  });

  it("maps DeltaUpdate to kind delta", () => {
    const ev = notificationToEvent(
      makeNotification("abc", UpdateDataType.DeltaUpdate, { delta: [9, 8] }),
    );
    expect(ev?.kind).toBe("delta");
    expect(ev?.bytes).toEqual(Uint8Array.from([9, 8]));
  });

  it("maps StateAndDeltaUpdate with state to kind state+delta", () => {
    const ev = notificationToEvent(
      makeNotification("abc", UpdateDataType.StateAndDeltaUpdate, {
        state: [5, 6],
        delta: [7],
      }),
    );
    expect(ev?.kind).toBe("state+delta");
    expect(ev?.bytes).toEqual(Uint8Array.from([5, 6]));
  });

  it("falls back to delta when StateAndDeltaUpdate has no state", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ev = notificationToEvent(
      makeNotification("abc", UpdateDataType.StateAndDeltaUpdate, { delta: [4, 5] }),
    );
    expect(ev?.kind).toBe("delta");
    expect(ev?.bytes).toEqual(Uint8Array.from([4, 5]));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null for missing key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ev = notificationToEvent(makeNotification("", UpdateDataType.StateUpdate, { state: [1] }));
    expect(ev).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null for NONE type", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ev = notificationToEvent(makeNotification("abc", UpdateDataType.NONE, {}));
    expect(ev).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
