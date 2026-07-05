import type { Message } from "../../store";

export type StockChartSeriesPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type StockChartInstrument = {
  symbol: string;
  name: string;
  chartType: "candlestick" | "line";
  points: StockChartSeriesPoint[];
};

export type StockChartPayload = {
  kind: "stock_chart";
  title: string;
  chartType: "candlestick" | "line";
  points: StockChartSeriesPoint[];
  /** When the user focuses multiple tickers, each entry becomes a switchable tab. */
  instruments: StockChartInstrument[];
  attribution?: string;
  /** Kimi-style header line, e.g. "获取数据 | AkShare（免费行情）". */
  dataSourceLabel?: string;
};

export type HtmlWidgetPayload = {
  title: string;
  widgetCode: string;
  loadingMessages: string[];
  kind: "svg" | "html";
};

export type WidgetPayload = HtmlWidgetPayload | StockChartPayload;

function widgetKind(widgetCode: string): "svg" | "html" {
  return widgetCode.trimStart().toLowerCase().startsWith("<svg") ? "svg" : "html";
}

function readNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStockPoint(raw: unknown): StockChartSeriesPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const date = String(row.date ?? row.日期 ?? row.year ?? row.Year ?? "").trim();
  const open = readNum(row.open ?? row.开盘);
  const high = readNum(row.high ?? row.最高);
  const low = readNum(row.low ?? row.最低);
  const close = readNum(row.close ?? row.收盘 ?? row.value ?? row.Value);
  if (!date || open === null || high === null || low === null || close === null) {
    return null;
  }
  const volumeRaw = readNum(row.volume ?? row.成交量 ?? row.vol);
  return {
    date,
    open,
    high,
    low,
    close,
    volume: volumeRaw === null ? undefined : volumeRaw,
  };
}

function parseInstrument(raw: unknown): StockChartInstrument | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const rawPoints = Array.isArray(row.points) ? row.points : row.data;
  if (!Array.isArray(rawPoints)) return null;
  const points = rawPoints
    .map((item) => normalizeStockPoint(item))
    .filter((item): item is StockChartSeriesPoint => item !== null);
  if (points.length === 0) return null;
  const chartType =
    row.chart_type === "line" || row.chartType === "line" ? "line" : "candlestick";
  const symbol = String(row.symbol ?? row.code ?? row.ticker ?? "").trim();
  const name = String(row.name ?? row.title ?? symbol).trim();
  return {
    symbol: symbol || name,
    name: name || symbol,
    chartType,
    points,
  };
}

function parseStockChartPayload(parsed: Record<string, unknown>): StockChartPayload | null {
  const watchlistRaw = parsed.watchlist ?? parsed.instruments ?? parsed.series;
  let instruments: StockChartInstrument[] = [];
  if (Array.isArray(watchlistRaw)) {
    instruments = watchlistRaw
      .map((item) => parseInstrument(item))
      .filter((item): item is StockChartInstrument => item !== null);
  }

  if (instruments.length === 0) {
    const rawPoints = Array.isArray(parsed.points) ? parsed.points : parsed.data;
    if (!Array.isArray(rawPoints)) return null;
    const points = rawPoints
      .map((item) => normalizeStockPoint(item))
      .filter((item): item is StockChartSeriesPoint => item !== null);
    if (points.length === 0) return null;
    const chartType =
      parsed.chart_type === "line" || parsed.chartType === "line" ? "line" : "candlestick";
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    instruments = [
      {
        symbol: title,
        name: title,
        chartType,
        points,
      },
    ];
  }

  const primary = instruments[0];
  const title =
    typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : primary.name || primary.symbol;

  return {
    kind: "stock_chart",
    title,
    chartType: primary.chartType,
    points: primary.points,
    instruments,
    attribution: typeof parsed.attribution === "string" ? parsed.attribution : undefined,
    dataSourceLabel:
      typeof parsed.data_source_label === "string"
        ? parsed.data_source_label
        : typeof parsed.dataSourceLabel === "string"
          ? parsed.dataSourceLabel
          : undefined,
  };
}

export function isBrokenStockChartAttempt(content: string): boolean {
  const raw = String(content ?? "").trim();
  if (!raw.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed.type === "stock_chart";
  } catch {
    return /"type"\s*:\s*"stock_chart"/.test(raw);
  }
}

export function stockChartDegradedMessage(): string {
  return "股票图表数据格式无效或缺少有效点位，无法渲染。请让助手重新调用 query_data_source 并传入完整 stock_chart JSON。";
}

export function parseWidgetPayload(content: string): WidgetPayload | null {
  const raw = String(content ?? "").trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.type === "stock_chart") {
      return parseStockChartPayload(parsed);
    }
    if (parsed.type !== "widget") return null;
    const widgetCode = typeof parsed.widget_code === "string" ? parsed.widget_code : "";
    if (!widgetCode.trim()) return null;
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const rawMsgs = parsed.loading_messages;
    const loadingMessages = Array.isArray(rawMsgs)
      ? rawMsgs.map((m) => String(m ?? "").trim()).filter(Boolean)
      : [];
    return {
      title,
      widgetCode,
      loadingMessages,
      kind: widgetKind(widgetCode),
    };
  } catch {
    return null;
  }
}

export function isShowWidgetToolMessage(message: Message): boolean {
  return String(message.toolName ?? "").trim() === "show_widget";
}
