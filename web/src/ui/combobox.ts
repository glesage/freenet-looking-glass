import { computeWindow, DEFAULT_OVERSCAN } from "./virtual-window";

export type KeyComboEntry = {
  kind: "key";
  keyId: string;
  badge?: "subscribed";
  summary?: string;
};

export type ComboEntry = KeyComboEntry | { kind: "loading" } | { kind: "error"; message: string };

export interface ComboboxOptions {
  getEntries: () => Promise<{ entries: KeyComboEntry[]; error?: string }>;
  onPick: (keyId: string) => void;
}

export interface ComboboxHandle {
  destroy: () => void;
  updateEntry: (keyId: string, summary: string) => void;
}

const ROW_PX = 52;

export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function entrySearchText(e: KeyComboEntry): string {
  return normalizeSearchText(`${e.keyId}\n${e.summary ?? ""}`);
}

export function filterEntries(
  entries: KeyComboEntry[],
  query: string,
  index?: Map<string, string>,
): KeyComboEntry[] {
  const q = normalizeSearchText(query);
  if (!q) return entries.slice();
  return entries.filter((e) => {
    const text = index?.get(e.keyId) ?? entrySearchText(e);
    return text.includes(q);
  });
}

export function attachCombobox(input: HTMLInputElement, options: ComboboxOptions): ComboboxHandle {
  const listId = `combo-list-${Math.random().toString(36).slice(2, 9)}`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "combo-panel";
  panel.id = listId;
  panel.setAttribute("role", "listbox");
  panel.hidden = true;
  panel.style.setProperty("--combo-row-px", `${ROW_PX}px`);
  input.parentElement?.appendChild(panel);

  let open = false;
  let highlight = -1;
  let keyEntries: KeyComboEntry[] = [];
  let listError: string | undefined;
  let loading = false;
  let loadGen = 0;
  let lastErrorHeight = 0;
  let revision = 0;
  let searchIndex = new Map<string, string>();
  let filterCache = { query: "", revision: -1, result: [] as KeyComboEntry[] };

  const setExpanded = (expanded: boolean): void => {
    input.setAttribute("aria-expanded", expanded ? "true" : "false");
  };

  const rebuildSearchIndex = (): void => {
    searchIndex = new Map(keyEntries.map((e) => [e.keyId, entrySearchText(e)]));
  };

  const filtered = (): KeyComboEntry[] => {
    const query = input.value;
    if (query === filterCache.query && revision === filterCache.revision) {
      return filterCache.result;
    }
    const result = filterEntries(keyEntries, query, searchIndex);
    filterCache = { query, revision, result };
    return result;
  };

  const close = (): void => {
    open = false;
    highlight = -1;
    panel.hidden = true;
    setExpanded(false);
    input.removeAttribute("aria-activedescendant");
  };

  const appendOption = (
    row: KeyComboEntry,
    absIdx: number,
    filteredLen: number,
    inWindow: boolean,
  ): void => {
    const opt = document.createElement("div");
    opt.className = "combo-row combo-option";
    opt.setAttribute("role", "option");
    opt.id = `${listId}-opt-${absIdx}`;
    opt.dataset.keyId = row.keyId;
    opt.setAttribute("aria-setsize", String(filteredLen));
    opt.setAttribute("aria-posinset", String(absIdx + 1));

    if (inWindow && absIdx === highlight) {
      opt.classList.add("active");
      opt.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", opt.id);
    } else {
      opt.setAttribute("aria-selected", "false");
    }

    const head = document.createElement("div");
    head.className = "combo-option-head";

    const keySpan = document.createElement("span");
    keySpan.className = "combo-key";
    keySpan.textContent = row.keyId;
    head.appendChild(keySpan);

    if (row.badge) {
      const badge = document.createElement("span");
      badge.className = "combo-badge muted";
      badge.textContent = row.badge;
      head.appendChild(badge);
    }

    opt.appendChild(head);

    const summarySpan = document.createElement("span");
    summarySpan.className = row.summary ? "combo-summary muted" : "combo-summary muted combo-summary-loading";
    summarySpan.textContent = row.summary ?? "…";
    opt.appendChild(summarySpan);

    opt.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      input.value = row.keyId;
      close();
      options.onPick(row.keyId);
    });

    panel.appendChild(opt);
  };

  const render = (): void => {
    const savedScrollTop = panel.scrollTop;
    panel.replaceChildren();

    if (loading) {
      const el = document.createElement("div");
      el.className = "combo-row combo-loading muted";
      el.setAttribute("role", "presentation");
      el.textContent = "Loading contracts…";
      panel.appendChild(el);
      input.removeAttribute("aria-activedescendant");
      return;
    }

    if (listError) {
      const el = document.createElement("div");
      el.className = "combo-row combo-error muted";
      el.setAttribute("role", "presentation");
      el.textContent = listError;
      panel.appendChild(el);
      lastErrorHeight = el.offsetHeight;
    } else {
      lastErrorHeight = 0;
    }

    const filteredList = filtered();
    if (filteredList.length === 0) {
      highlight = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }

    highlight = Math.min(highlight, filteredList.length - 1);

    const errorOffset = lastErrorHeight;
    const effectiveScrollTop = Math.max(0, savedScrollTop - errorOffset);
    const win = computeWindow(
      filteredList.length,
      effectiveScrollTop,
      panel.clientHeight,
      ROW_PX,
      DEFAULT_OVERSCAN,
    );

    const highlightInWindow = highlight >= win.start && highlight < win.end;
    if (!highlightInWindow) {
      input.removeAttribute("aria-activedescendant");
    }

    const topSpacer = document.createElement("div");
    topSpacer.className = "combo-spacer-top";
    topSpacer.style.height = `${win.topPad}px`;
    topSpacer.setAttribute("role", "presentation");
    panel.appendChild(topSpacer);

    for (let absIdx = win.start; absIdx < win.end; absIdx++) {
      appendOption(filteredList[absIdx], absIdx, filteredList.length, highlightInWindow);
    }

    const bottomSpacer = document.createElement("div");
    bottomSpacer.className = "combo-spacer-bottom";
    bottomSpacer.style.height = `${win.bottomPad}px`;
    bottomSpacer.setAttribute("role", "presentation");
    panel.appendChild(bottomSpacer);

    panel.scrollTop = Math.min(savedScrollTop, Math.max(0, panel.scrollHeight - panel.clientHeight));
  };

  const refreshEntries = async (): Promise<void> => {
    const gen = ++loadGen;
    loading = true;
    if (open) render();
    try {
      const result = await options.getEntries();
      if (gen !== loadGen) return;
      keyEntries = result.entries;
      listError = result.error;
      rebuildSearchIndex();
      revision++;
    } catch (e) {
      if (gen !== loadGen) return;
      keyEntries = [];
      listError = e instanceof Error ? e.message : String(e);
      rebuildSearchIndex();
      revision++;
    } finally {
      if (gen === loadGen) {
        loading = false;
        if (open) render();
      }
    }
  };

  const openPanel = (): void => {
    open = true;
    panel.hidden = false;
    setExpanded(true);
    panel.scrollTop = 0;
    render();
    void refreshEntries();
  };

  const highlightKeyAt = (index: number): void => {
    const list = filtered();
    if (list.length === 0) return;
    highlight = ((index % list.length) + list.length) % list.length;

    const errorOffset = lastErrorHeight;
    const effectiveScrollTop = Math.max(0, panel.scrollTop - errorOffset);
    if (highlight * ROW_PX < effectiveScrollTop) {
      panel.scrollTop = errorOffset + highlight * ROW_PX;
    } else if ((highlight + 1) * ROW_PX > effectiveScrollTop + panel.clientHeight) {
      panel.scrollTop = errorOffset + (highlight + 1) * ROW_PX - panel.clientHeight;
    }

    render();
  };

  const pickHighlighted = (): boolean => {
    const list = filtered();
    if (highlight < 0 || highlight >= list.length) return false;
    const keyId = list[highlight].keyId;
    input.value = keyId;
    close();
    options.onPick(keyId);
    return true;
  };

  const updateEntry = (keyId: string, summary: string): void => {
    const idx = keyEntries.findIndex((e) => e.keyId === keyId);
    if (idx >= 0) {
      keyEntries[idx] = { ...keyEntries[idx], summary };
      searchIndex.set(keyId, entrySearchText(keyEntries[idx]));
      revision++;
    }
    if (open) render();
  };

  const onPanelScroll = (): void => {
    if (open && !loading) render();
  };

  const onPanelPointerDown = (ev: PointerEvent): void => {
    ev.preventDefault();
  };

  panel.addEventListener("scroll", onPanelScroll);
  panel.addEventListener("pointerdown", onPanelPointerDown);

  input.addEventListener("focus", () => openPanel());

  input.addEventListener("click", () => {
    if (!open) openPanel();
  });

  input.addEventListener("input", () => {
    highlight = -1;
    panel.scrollTop = 0;
    if (!open) openPanel();
    else render();
  });

  input.addEventListener("keydown", (ev) => {
    if (!open) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
      return;
    }
    if (ev.key === "Enter") {
      if (pickHighlighted()) ev.preventDefault();
      return;
    }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const delta = ev.key === "ArrowDown" ? 1 : -1;
      const base = highlight < 0 ? (ev.key === "ArrowDown" ? -1 : 0) : highlight;
      highlightKeyAt(base + delta);
    }
  });

  input.addEventListener("blur", () => {
    close();
  });

  const destroy = (): void => {
    panel.removeEventListener("scroll", onPanelScroll);
    panel.removeEventListener("pointerdown", onPanelPointerDown);
    panel.remove();
    input.removeAttribute("role");
    input.removeAttribute("aria-autocomplete");
    input.removeAttribute("aria-controls");
    input.removeAttribute("aria-expanded");
    input.removeAttribute("aria-activedescendant");
  };

  return { destroy, updateEntry };
}
