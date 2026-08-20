// Update-activity chart: one SVG bar per received update, height scaled by
// payload size. Hand-rolled — no chart library, nothing external to vendor.

export interface TimelinePoint {
  t: number; // epoch ms
  size: number; // payload bytes
  kind: string; // "state" | "delta" | ...
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_BARS = 60;

export function renderTimeline(points: TimelinePoint[]): SVGSVGElement {
  const shown = points.slice(-MAX_BARS);
  const width = 600;
  const height = 90;
  const pad = 4;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "timeline");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Update activity: payload size per update");

  if (shown.length === 0) {
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(width / 2));
    text.setAttribute("y", String(height / 2));
    text.setAttribute("class", "timeline-empty");
    text.setAttribute("text-anchor", "middle");
    text.textContent = "no updates received yet";
    svg.appendChild(text);
    return svg;
  }

  const maxSize = Math.max(...shown.map((p) => p.size), 1);
  const slot = (width - pad * 2) / MAX_BARS;
  const barW = Math.max(2, slot - 2);

  shown.forEach((p, i) => {
    // log scale so one huge full-state push doesn't flatten the deltas
    const frac = Math.log1p(p.size) / Math.log1p(maxSize);
    const h = Math.max(2, frac * (height - pad * 2));
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(pad + i * slot));
    rect.setAttribute("y", String(height - pad - h));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", String(h));
    rect.setAttribute("class", p.kind === "delta" ? "bar bar-delta" : "bar bar-state");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${new Date(p.t).toLocaleTimeString()} · ${p.kind} · ${formatBytes(p.size)}`;
    rect.appendChild(title);
    svg.appendChild(rect);
  });

  return svg;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}
