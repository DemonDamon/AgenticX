import type { StockChartInstrument, StockChartSeriesPoint } from "./widget-preview";

export type StockQuoteSnapshot = {
  date: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume?: number;
};

export function computeQuoteSnapshot(points: StockChartSeriesPoint[]): StockQuoteSnapshot | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : last;
  const price = last.close;
  const prevClose = prev.close;
  const change = price - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  return {
    date: last.date,
    price,
    change,
    changePct,
    open: last.open,
    high: last.high,
    low: last.low,
    volume: last.volume,
  };
}

export function formatStockPrice(value: number): string {
  return value.toFixed(2);
}

export function formatSignedChange(change: number, pct: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}(${sign}${pct.toFixed(2)}%)`;
}

export function formatVolumeCn(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
  return String(Math.round(value));
}

export function formatChartAxisDate(date: string): string {
  const raw = String(date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(5);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.length > 8 ? raw.slice(0, 8) : raw;
}

export function instrumentTabLabel(instrument: StockChartInstrument): string {
  const snap = computeQuoteSnapshot(instrument.points);
  const price = snap ? formatStockPrice(snap.price) : "—";
  const label = instrument.name || instrument.symbol;
  return `${label} ${price}`;
}

export function isPriceUp(change: number): boolean {
  return change >= 0;
}
