// Renders decoded (UNTRUSTED) values as DOM. Everything goes through
// createElement/textContent — never innerHTML — so hostile contract state
// cannot inject markup into the page.

import { DecodedBytes } from "../decoders";
import { toHex } from "../cbor";

const MAX_RENDER_DEPTH = 32;
const TABLE_MAX_COLUMNS = 12;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderRoot(value: unknown): HTMLElement {
  const container = el("div", "tree-root");

  if (value === null || value === undefined) {
    container.appendChild(renderScalar(value));
    return container;
  }

  const unwrapped = unwrapDecodedBytes(value);
  const suffix = decodedSuffix(value);

  if (typeof unwrapped === "string" && !(value instanceof DecodedBytes)) {
    const pre = el("pre", "text-view");
    pre.textContent = unwrapped;
    container.appendChild(pre);
    return container;
  }

  if (typeof unwrapped !== "object" || unwrapped instanceof Uint8Array) {
    container.appendChild(renderScalar(unwrapped));
    if (suffix) container.appendChild(el("span", "val-muted decoded-suffix", suffix));
    return container;
  }

  const entries = Array.isArray(unwrapped)
    ? unwrapped.map((v, i) => [String(i), v] as const)
    : Object.entries(unwrapped as Record<string, unknown>);

  for (const [key, val] of entries) {
    container.appendChild(renderEntry(key, val, 0));
  }
  return container;
}

export function renderValue(value: unknown, depth = 0): HTMLElement {
  if (depth > MAX_RENDER_DEPTH) return el("span", "val-muted", "…");
  return renderScalar(unwrapDecodedBytes(value));
}

function renderEntry(key: string, value: unknown, depth: number): HTMLElement {
  if (depth > MAX_RENDER_DEPTH) return el("div", "tree-entry", "…");

  const suffix = decodedSuffix(value);
  const inner = unwrapDecodedBytes(value);

  if (isScalarLeaf(inner)) {
    const row = el("div", "tree-entry tree-scalar");
    row.appendChild(el("span", "tree-key", `${key}:`));
    const valNode = renderScalar(inner);
    row.appendChild(valNode);
    if (suffix) row.appendChild(el("span", "val-muted decoded-suffix", suffix));
    return row;
  }

  const details = el("details", "tree");

  const summary = el("summary", "tree-summary");
  summary.dataset.key = key;
  summary.appendChild(el("span", "tree-key", key));
  summary.appendChild(el("span", "val-muted tree-hint", typeHint(inner)));
  if (suffix) summary.appendChild(el("span", "val-muted decoded-suffix", suffix));
  details.appendChild(summary);

  let rendered = false;
  details.addEventListener("toggle", () => {
    if (details.open) {
      if (!rendered) {
        rendered = true;
        details.appendChild(renderChildren(inner, depth));
      }
      return;
    }
    for (const child of [...details.children]) {
      if (child !== summary) child.remove();
    }
    rendered = false;
  });

  return details;
}

function renderChildren(value: unknown, depth: number): HTMLElement {
  const inner = unwrapDecodedBytes(value);

  if (Array.isArray(inner)) {
    return renderArrayPreview(inner, depth);
  }

  if (inner !== null && typeof inner === "object") {
    const entries = Object.entries(inner as Record<string, unknown>);
    const list = el("div", "tree-entries");
    for (const [k, v] of entries) {
      list.appendChild(renderEntry(k, v, depth + 1));
    }
    return list;
  }

  const wrap = el("div", "tree-entries");
  wrap.appendChild(renderScalar(inner));
  return wrap;
}

function renderArrayPreview(items: unknown[], depth: number): HTMLElement {
  const wrap = el("div", "array-preview");

  if (items.length === 0) {
    wrap.appendChild(el("span", "val-muted", "[] (empty)"));
    return wrap;
  }

  const columns = getTableColumns(items);
  if (columns) {
    wrap.appendChild(renderExpandableTable(items, columns, depth + 1));
    return wrap;
  }

  wrap.appendChild(renderNonTableArrayPreview(items, depth + 1));
  return wrap;
}

function renderNonTableArrayPreview(items: unknown[], depth: number): HTMLElement {
  const wrap = el("div", "array-preview-fallback");
  wrap.appendChild(renderEntry("0", items[0], depth));
  if (items.length > 1) {
    const rest = el("div", "array-rest");
    rest.hidden = true;
    const list = el("div", "tree-entries");
    for (let i = 1; i < items.length; i++) {
      list.appendChild(renderEntry(String(i), items[i], depth));
    }
    rest.appendChild(list);
    const showBtn = el("button", "array-show-all", `Show all ${items.length} items`);
    showBtn.addEventListener("click", () => {
      const open = rest.hidden;
      rest.hidden = !open;
      showBtn.textContent = open ? "Show first item only" : `Show all ${items.length} items`;
    });
    wrap.appendChild(showBtn);
    wrap.appendChild(rest);
  }
  return wrap;
}

function renderExpandableTable(
  items: unknown[],
  columns: string[],
  depth: number,
): HTMLElement {
  const wrap = el("div", "array-table-preview");
  const tableWrap = el("div", "table-scroll");
  const table = el("table", "data-table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", "row-index", "#"));
  for (const col of columns) headRow.appendChild(el("th", undefined, col));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  items.forEach((item, i) => {
    const row = renderTableRow(item, i, columns, depth);
    if (i > 0) row.hidden = true;
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  if (items.length > 1) {
    let showingAll = false;
    const toggleBtn = el("button", "array-show-all", `Show all ${items.length} items`);
    toggleBtn.addEventListener("click", () => {
      showingAll = !showingAll;
      for (let i = 1; i < items.length; i++) {
        (tbody.children[i] as HTMLElement).hidden = !showingAll;
      }
      toggleBtn.textContent = showingAll
        ? "Show first item only"
        : `Show all ${items.length} items`;
    });
    wrap.appendChild(toggleBtn);
  }

  return wrap;
}

function renderTableRow(
  item: unknown,
  index: number,
  columns: string[],
  depth: number,
): HTMLTableRowElement {
  const row = el("tr");
  row.appendChild(el("td", "row-index", String(index)));
  const record = item as Record<string, unknown>;
  for (const col of columns) {
    const cell = el("td");
    if (col in record) {
      cell.appendChild(renderTableCell(record[col], depth));
    } else {
      cell.appendChild(el("span", "val-muted", "—"));
    }
    row.appendChild(cell);
  }
  return row;
}

function getTableColumns(items: unknown[]): string[] | null {
  if (items.length === 0) return null;
  const columns: string[] = [];
  for (const item of items) {
    if (
      item === null ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      item instanceof Uint8Array
    ) {
      return null;
    }
    for (const key of Object.keys(item)) {
      if (!columns.includes(key)) {
        columns.push(key);
        if (columns.length > TABLE_MAX_COLUMNS) return null;
      }
    }
  }
  return columns;
}

function isScalarLeaf(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (value instanceof Uint8Array) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "bigint" || t === "boolean") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return true;
}

function typeHint(value: unknown): string {
  if (Array.isArray(value)) {
    return `array · ${value.length} items`;
  }
  if (value !== null && typeof value === "object") {
    return `object · ${Object.keys(value as object).length} fields`;
  }
  return "";
}

function unwrapDecodedBytes(value: unknown): unknown {
  if (value instanceof DecodedBytes) return value.value;
  return value;
}

function decodedSuffix(value: unknown): string | null {
  if (!(value instanceof DecodedBytes)) return null;
  return `(decoded from ${value.byteLength} bytes of ${value.source})`;
}

function renderScalar(value: unknown): HTMLElement {
  if (value === null) return el("span", "val-null", "null");
  if (value === undefined) return el("span", "val-null", "undefined");

  switch (typeof value) {
    case "boolean":
      return el("span", "val-bool", String(value));
    case "number":
    case "bigint":
      return el("span", "val-num", String(value));
    case "string":
      return el("span", "val-str", value);
  }

  if (value instanceof Uint8Array) {
    return el("span", "val-bytes", `bytes[${value.length}] 0x${toHex(value, 48)}`);
  }

  if (Array.isArray(value)) {
    return el("span", "val-muted", `[] (${value.length} items)`);
  }

  if (typeof value === "object") {
    return el("span", "val-muted", `{} (${Object.keys(value as object).length} fields)`);
  }

  return el("span", "val-muted", String(value));
}

function renderTableCell(value: unknown, depth: number): HTMLElement {
  if (depth > MAX_RENDER_DEPTH) return el("span", "val-muted", "…");
  const inner = unwrapDecodedBytes(value);
  if (isScalarLeaf(inner)) {
    const node = renderScalar(inner);
    const suffix = decodedSuffix(value);
    if (suffix) {
      const wrap = el("span", "table-cell-inline");
      wrap.appendChild(node);
      wrap.appendChild(el("span", "val-muted decoded-suffix", suffix));
      return wrap;
    }
    return node;
  }
  return renderTableCellBody(inner, depth);
}

function renderTableCellBody(inner: unknown, depth: number): HTMLElement {
  const body = el("div", "table-cell-body");
  if (Array.isArray(inner)) {
    body.appendChild(renderArrayPreview(inner, depth));
    return body;
  }
  if (inner !== null && typeof inner === "object") {
    for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
      body.appendChild(renderTableCellField(k, v, depth + 1));
    }
    return body;
  }
  body.appendChild(renderScalar(inner));
  return body;
}

function renderTableCellField(key: string, value: unknown, depth: number): HTMLElement {
  const row = el("div", "table-cell-field");
  row.appendChild(el("span", "tree-key", `${key}:`));
  row.appendChild(renderTableCell(value, depth));
  return row;
}
