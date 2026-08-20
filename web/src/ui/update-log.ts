import type { DiffEntry } from "../state-diff";
import { diffSummary } from "../state-diff";
import { el } from "./render";

export interface UpdateLogRow {
  time: string;
  kind: string;
  size: string;
  sha256: string;
  diff?: DiffEntry[];
}

const COLUMNS = ["time", "kind", "size", "sha256", "changes"] as const;

export function renderUpdateLog(entries: UpdateLogRow[]): HTMLElement {
  const tableWrap = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const col of COLUMNS) headRow.appendChild(el("th", undefined, col));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const entry of entries) {
    const tr = el("tr");
    tr.appendChild(el("td", undefined, entry.time));
    tr.appendChild(el("td", undefined, entry.kind));
    tr.appendChild(el("td", undefined, entry.size));
    tr.appendChild(el("td", undefined, entry.sha256));
    tr.appendChild(renderChangesCell(entry));
    tbody.appendChild(tr);

    if (entry.diff && entry.diff.length > 0) {
      const detail = el("tr", "diff-detail");
      detail.hidden = true;
      const detailCell = el("td");
      detailCell.colSpan = COLUMNS.length;
      for (const line of entry.diff) {
        detailCell.appendChild(renderDiffLine(line));
      }
      detail.appendChild(detailCell);
      tbody.appendChild(detail);

      const toggle = tr.querySelector(".diff-toggle") as HTMLButtonElement;
      toggle.addEventListener("click", () => {
        detail.hidden = !detail.hidden;
      });
    }
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  return tableWrap;
}

function renderChangesCell(entry: UpdateLogRow): HTMLTableCellElement {
  const cell = el("td");

  if (entry.diff === undefined) {
    cell.textContent = entry.kind === "delta" ? "—" : "no baseline";
    return cell;
  }

  if (entry.diff.length === 0) {
    cell.textContent = "no change";
    return cell;
  }

  const toggle = el("button", "diff-toggle", diffSummary(entry.diff));
  toggle.type = "button";
  cell.appendChild(toggle);
  return cell;
}

function renderDiffLine(entry: DiffEntry): HTMLElement {
  const line = el("div", `diff-line diff-${entry.op}`);
  line.appendChild(el("span", "diff-path", entry.path));

  if (entry.op === "added") {
    line.appendChild(document.createTextNode(` → ${entry.after ?? ""}`));
  } else if (entry.op === "removed") {
    line.appendChild(document.createTextNode(` ${entry.before ?? ""} →`));
  } else if (entry.path === "… (truncated)") {
    line.textContent = entry.path;
  } else {
    line.appendChild(
      document.createTextNode(` ${entry.before ?? ""} → ${entry.after ?? ""}`),
    );
  }

  return line;
}
