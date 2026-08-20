// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderUpdateLog } from "./update-log";

describe("renderUpdateLog", () => {
  it("renders a table with header and one visible body row per entry", () => {
    const root = renderUpdateLog([
      { time: "10:00:01", kind: "delta", size: "12 B", sha256: "abc…" },
      { time: "10:00:02", kind: "state", size: "4 KiB", sha256: "def…", diff: [] },
      {
        time: "10:00:03",
        kind: "state+delta",
        size: "4 KiB",
        sha256: "ghi…",
        diff: [{ path: "x", op: "added", after: "1" }],
      },
    ]);

    expect(root.className).toBe("table-scroll");
    const table = root.querySelector("table.data-table");
    expect(table).not.toBeNull();

    const headerCells = table!.querySelectorAll("thead th");
    expect([...headerCells].map((c) => c.textContent)).toEqual([
      "time",
      "kind",
      "size",
      "sha256",
      "changes",
    ]);

    const mainRows = table!.querySelectorAll("tbody > tr:not(.diff-detail)");
    expect(mainRows).toHaveLength(3);
    expect([...mainRows].every((r) => !(r as HTMLElement).hidden)).toBe(true);

    const firstRowCells = mainRows[0]!.querySelectorAll("td");
    expect([...firstRowCells].map((c) => c.textContent)).toEqual([
      "10:00:01",
      "delta",
      "12 B",
      "abc…",
      "—",
    ]);
  });

  it("renders a dash for delta rows without a toggle", () => {
    const root = renderUpdateLog([
      { time: "10:00:01", kind: "delta", size: "12 B", sha256: "abc…" },
    ]);
    const changesCell = root.querySelector("tbody tr td:last-child");
    expect(changesCell?.textContent).toBe("—");
    expect(root.querySelector(".diff-toggle")).toBeNull();
  });

  it("toggles diff detail rows for state updates", () => {
    const root = renderUpdateLog([
      {
        time: "10:00:02",
        kind: "state",
        size: "4 KiB",
        sha256: "def…",
        diff: [
          { path: "a", op: "added", after: "1" },
          { path: "b", op: "added", after: "2" },
          { path: "c", op: "changed", before: "1", after: "2" },
        ],
      },
    ]);

    const toggle = root.querySelector(".diff-toggle") as HTMLButtonElement;
    expect(toggle.textContent).toBe("+2 ~1 −0");

    const detail = root.querySelector("tr.diff-detail") as HTMLTableRowElement;
    expect(detail.hidden).toBe(true);

    toggle.click();
    expect(detail.hidden).toBe(false);

    const lines = detail.querySelectorAll(".diff-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.classList.contains("diff-added")).toBe(true);
    expect(lines[2]!.classList.contains("diff-changed")).toBe(true);
    expect(lines[0]!.textContent).toContain("a");
    expect(lines[0]!.textContent).toContain("1");

    toggle.click();
    expect(detail.hidden).toBe(true);
  });

  it("shows no change as plain text without a toggle", () => {
    const root = renderUpdateLog([
      { time: "10:00:02", kind: "state", size: "4 KiB", sha256: "def…", diff: [] },
    ]);
    const changesCell = root.querySelector("tbody tr td:last-child");
    expect(changesCell?.textContent).toBe("no change");
    expect(root.querySelector(".diff-toggle")).toBeNull();
  });

  it("renders hostile diff text via textContent only", () => {
    const payload = '<img src=x onerror=alert(1)>';
    const root = renderUpdateLog([
      {
        time: "10:00:02",
        kind: "state",
        size: "4 KiB",
        sha256: "def…",
        diff: [{ path: "html", op: "added", after: payload }],
      },
    ]);

    const toggle = root.querySelector(".diff-toggle") as HTMLButtonElement;
    toggle.click();

    expect(root.textContent).toContain(payload);
    expect(root.querySelector("img")).toBeNull();
  });
});
