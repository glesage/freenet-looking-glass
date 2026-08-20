// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderRowsTable } from "./render";

describe("renderRowsTable", () => {
  it("renders a table with header and all body rows visible", () => {
    const rows = [
      { time: "10:00:01", kind: "delta", size: "12 B", sha256: "abc…" },
      { time: "10:00:02", kind: "state", size: "4 KiB", sha256: "def…" },
      { time: "10:00:03", kind: "state+delta", size: "4 KiB", sha256: "ghi…" },
    ];
    const columns = ["time", "kind", "size", "sha256"];

    const root = renderRowsTable(rows, columns);

    expect(root.className).toBe("table-scroll");
    const table = root.querySelector("table.data-table");
    expect(table).not.toBeNull();

    const headerCells = table!.querySelectorAll("thead th");
    expect([...headerCells].map((c) => c.textContent)).toEqual(columns);

    const bodyRows = table!.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(3);
    expect([...bodyRows].every((r) => !(r as HTMLElement).hidden)).toBe(true);

    const firstRowCells = bodyRows[0]!.querySelectorAll("td");
    expect([...firstRowCells].map((c) => c.textContent)).toEqual([
      "10:00:01",
      "delta",
      "12 B",
      "abc…",
    ]);
  });
});
