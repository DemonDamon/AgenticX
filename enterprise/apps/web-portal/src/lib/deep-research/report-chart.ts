/**
 * Deep-research chart spec: ```chart fenced JSON → xychart / inline SVG / GFM table.
 * No heavy chart libs — deterministic transforms only (offline-safe).
 */

export type ChartSpec = {
  type: "bar" | "line" | "pie" | "scatter";
  title: string;
  x: string[];
  series: Array<{ name: string; data: number[] }>;
};

const CHART_TYPES = new Set(["bar", "line", "pie", "scatter"]);
const MAX_X = 24;
const MAX_SERIES = 4;
const MAX_POINTS = 48;

function escapeText(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Parse + validate a ```chart JSON payload.
 * Strict shape (x 与每条 series 等长) so a sloppy model output fails to table/code,
 * never to a misleading figure.
 */
export function parseChartSpec(raw: string): ChartSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;

  const type = typeof row.type === "string" ? row.type.trim().toLowerCase() : "";
  if (!CHART_TYPES.has(type)) return null;

  const x = Array.isArray(row.x)
    ? row.x
        .map((v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""))
        .filter(Boolean)
        .slice(0, MAX_X)
    : [];
  if (x.length === 0) return null;

  const seriesRaw = Array.isArray(row.series) ? row.series : [];
  const series: Array<{ name: string; data: number[] }> = [];
  for (const item of seriesRaw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : `系列${series.length + 1}`;
    const data = Array.isArray(s.data)
      ? s.data
          .map((n) => (typeof n === "number" && Number.isFinite(n) ? n : NaN))
          .filter((n) => Number.isFinite(n))
          .slice(0, MAX_POINTS)
    : [];
    if (data.length !== x.length) continue;
    series.push({ name, data });
    if (series.length >= MAX_SERIES) break;
  }
  if (series.length === 0) return null;
  // pie 语义是「单系列占比」，多系列无法诚实表达。
  if (type === "pie" && series.length !== 1) return null;

  const title = typeof row.title === "string" ? row.title.trim().slice(0, 120) : "";
  return { type: type as ChartSpec["type"], title, x, series };
}

/** bar / line → Mermaid xychart-beta（复用正文 Mermaid 渲染链，零新增依赖）。 */
export function chartSpecToXyChart(spec: ChartSpec): string | null {
  if (spec.type !== "bar" && spec.type !== "line") return null;
  const allValues = spec.series.flatMap((s) => s.data);
  const maxValue = allValues.reduce((acc, n) => Math.max(acc, n), 0);
  const minValue = allValues.reduce((acc, n) => Math.min(acc, n), 0);
  const yMax = Math.max(1, Math.ceil(maxValue * 1.1));
  const yMin = Math.min(0, Math.floor(minValue * 1.1));
  const lines = ["xychart-beta"];
  if (spec.title) lines.push(`    title "${spec.title.replace(/"/g, "'")}"`);
  lines.push(`    x-axis [${spec.x.map((label) => `"${label.replace(/"/g, "'")}"`).join(", ")}]`);
  lines.push(`    y-axis ${yMin} --> ${yMax}`);
  for (const s of spec.series) {
    lines.push(`    ${spec.type} [${s.data.join(", ")}]`);
  }
  return lines.join("\n");
}

const SVG_PALETTE = ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

/** pie → 环形图；scatter → 散点图。确定性 SVG，<100 行。 */
export function chartSpecToSvg(spec: ChartSpec): string | null {
  if (spec.type === "pie") {
    const s = spec.series[0]!;
    const total = s.data.reduce((acc, n) => acc + Math.max(0, n), 0);
    if (total <= 0) return null;
    const cx = 110;
    const cy = 90;
    const r = 60;
    let angle = -Math.PI / 2;
    const parts: string[] = [];
    s.data.forEach((value, i) => {
      const frac = Math.max(0, value) / total;
      const a0 = angle;
      angle += frac * Math.PI * 2;
      const a1 = angle;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const color = SVG_PALETTE[i % SVG_PALETTE.length]!;
      parts.push(
        `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${color}"/>`,
      );
    });
    parts.push(`<circle cx="${cx}" cy="${cy}" r="34" fill="#ffffff"/>`);
    const legend = spec.x
      .map((label, i) => {
        const color = SVG_PALETTE[i % SVG_PALETTE.length]!;
        const pct = ((Math.max(0, s.data[i]!) / total) * 100).toFixed(1);
        return `<div class="chart-legend-item"><span class="chart-dot" style="background:${color}"></span>${escapeText(label)} · ${pct}%</div>`;
      })
      .join("");
    const title = spec.title ? `<div class="chart-title">${escapeText(spec.title)}</div>` : "";
    return `<figure class="chart-figure">${title}<svg viewBox="0 0 220 180" role="img" aria-label="${escapeText(spec.title || "饼图")}" width="220" height="180">${parts.join("")}</svg><figcaption class="chart-legend">${legend}</figcaption></figure>`;
  }

  if (spec.type === "scatter") {
    const s = spec.series[0]!;
    const maxY = Math.max(1, ...s.data);
    const minY = Math.min(0, ...s.data);
    const span = Math.max(1e-6, maxY - minY);
    const w = 320;
    const h = 180;
    const pad = 28;
    const points = s.data
      .map((value, i) => {
        const px = pad + (i / Math.max(1, s.data.length - 1)) * (w - pad * 2);
        const py = h - pad - ((value - minY) / span) * (h - pad * 2);
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${SVG_PALETTE[0]}"><title>${escapeText(spec.x[i] ?? "")}: ${value}</title></circle>`;
      })
      .join("");
    const title = spec.title ? `<div class="chart-title">${escapeText(spec.title)}</div>` : "";
    return `<figure class="chart-figure">${title}<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeText(spec.title || "散点图")}" width="${w}" height="${h}"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#cbd5e1"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="#cbd5e1"/>${points}</svg><figcaption class="chart-legend">${escapeText(s.name)}（${spec.x[0]} … ${spec.x[spec.x.length - 1]}）</figcaption></figure>`;
  }

  return null;
}

/** 最终兜底：spec → GFM 表（数据不丢，只丢图形）。 */
export function chartSpecToGfmTable(spec: ChartSpec): string {
  const header = `| 指标 | ${spec.x.join(" | ")} |`;
  const sep = `| --- | ${spec.x.map(() => "---").join(" | ")} |`;
  const rows = spec.series.map((s) => `| ${s.name} | ${s.data.join(" | ")} |`);
  return [header, sep, ...rows].join("\n");
}
