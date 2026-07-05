import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { Database, Maximize2 } from "lucide-react";
import { Modal } from "../ds/Modal";
import { ZoomableViewport } from "../ds/ZoomableViewport";
import { buildStockChartOption } from "./stock-chart-options";
import {
  computeQuoteSnapshot,
  formatSignedChange,
  formatStockPrice,
  formatVolumeCn,
  instrumentTabLabel,
  isPriceUp,
} from "./stock-chart-stats";
import type { StockChartInstrument, StockChartPayload } from "./widget-preview";

type Props = {
  payload: StockChartPayload;
  activeInstrument: StockChartInstrument;
  height?: number;
  showZoom?: boolean;
  onZoom?: () => void;
};

function instrumentChartPayload(
  base: StockChartPayload,
  instrument: StockChartInstrument,
): StockChartPayload {
  return {
    ...base,
    title: instrument.name || instrument.symbol,
    chartType: instrument.chartType,
    points: instrument.points,
  };
}

function QuoteMetrics({ snapshot }: { snapshot: ReturnType<typeof computeQuoteSnapshot> }) {
  if (!snapshot) return null;
  const items = [
    { label: "今开", value: formatStockPrice(snapshot.open) },
    { label: "收盘", value: formatStockPrice(snapshot.price) },
    { label: "最高", value: formatStockPrice(snapshot.high) },
    { label: "最低", value: formatStockPrice(snapshot.low) },
    { label: "成交量", value: formatVolumeCn(snapshot.volume) },
  ];
  return (
    <div className="mt-3 grid grid-cols-5 gap-2 border-t border-border/60 pt-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 text-center">
          <div className="text-[11px] text-text-muted">{item.label}</div>
          <div className="mt-0.5 truncate text-[13px] font-medium tabular-nums text-text-strong">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StockChartWidget({
  payload,
  activeInstrument,
  height = 300,
  showZoom = false,
  onZoom,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [truncated, setTruncated] = useState(false);
  const chartPayload = useMemo(
    () => instrumentChartPayload(payload, activeInstrument),
    [payload, activeInstrument],
  );
  const snapshot = useMemo(
    () => computeQuoteSnapshot(activeInstrument.points),
    [activeInstrument.points],
  );
  const up = snapshot ? isPriceUp(snapshot.change) : true;
  const priceColor = up ? "text-[var(--status-error)]" : "text-[var(--status-success)]";

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const chart = echarts.init(node, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const render = () => {
      const option = buildStockChartOption(chartPayload);
      setTruncated(Boolean((option as { _truncated?: boolean })._truncated));
      const { _truncated: _drop, ...echartsOption } = option as Record<string, unknown> & {
        _truncated?: boolean;
      };
      void _drop;
      chart.setOption(echartsOption, true);
    };

    render();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => chart.resize())
        : null;
    observer?.observe(node);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);

    const themeObserver = new MutationObserver(() => render());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      themeObserver.disconnect();
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, [chartPayload]);

  return (
    <div className="relative w-full min-w-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[13px] font-medium text-text-strong">
              {activeInstrument.symbol}
            </span>
            {activeInstrument.name && activeInstrument.name !== activeInstrument.symbol ? (
              <span className="text-[13px] text-text-subtle">{activeInstrument.name}</span>
            ) : null}
            {snapshot?.date ? (
              <span className="text-[12px] tabular-nums text-text-muted">{snapshot.date}</span>
            ) : null}
          </div>
          {snapshot ? (
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className={`text-[28px] font-semibold leading-none tabular-nums ${priceColor}`}>
                {formatStockPrice(snapshot.price)}
              </span>
              <span className={`pb-0.5 text-[14px] font-medium tabular-nums ${priceColor}`}>
                {formatSignedChange(snapshot.change, snapshot.changePct)}
              </span>
            </div>
          ) : null}
        </div>
        {showZoom && onZoom ? (
          <button
            type="button"
            onClick={onZoom}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md border border-border bg-[var(--surface-card)] text-text-faint transition hover:bg-[var(--surface-card-strong)] hover:text-text-subtle"
            title="放大查看"
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
      </div>

      <QuoteMetrics snapshot={snapshot} />

      {truncated ? (
        <div className="mt-2 text-[11px] text-amber-500/90">已收起早期数据，仅展示最近 500 条</div>
      ) : null}

      <div ref={ref} className="mt-3 w-full" style={{ height }} />
    </div>
  );
}

function WatchlistTabs({
  instruments,
  activeIndex,
  onSelect,
}: {
  instruments: StockChartInstrument[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  if (instruments.length <= 1) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {instruments.map((item, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${item.symbol}-${index}`}
            type="button"
            onClick={() => onSelect(index)}
            className={[
              "rounded-full border px-3 py-1.5 text-[12px] font-medium tabular-nums transition",
              active
                ? "border-border bg-[var(--surface-card-strong)] text-text-strong shadow-sm"
                : "border-transparent bg-[var(--surface-hover)] text-text-subtle hover:text-text-strong",
            ].join(" ")}
          >
            {instrumentTabLabel(item)}
          </button>
        );
      })}
    </div>
  );
}

function DataSourceBar({ payload }: { payload: StockChartPayload }) {
  const label =
    payload.dataSourceLabel ||
    (payload.attribution ? `获取数据 | ${payload.attribution.replace(/^数据来源：/, "")}` : "");
  if (!label) return null;
  return (
    <div className="mb-3 flex items-center gap-1.5 text-[12px] text-text-muted">
      <Database size={13} className="shrink-0 opacity-70" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export function StockChartWidgetBlock({ payload }: { payload: StockChartPayload }) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const instruments = payload.instruments.length > 0 ? payload.instruments : [];
  const safeIndex = Math.min(activeIndex, Math.max(0, instruments.length - 1));
  const activeInstrument = instruments[safeIndex] ?? {
    symbol: payload.title,
    name: payload.title,
    chartType: payload.chartType,
    points: payload.points,
  };

  return (
    <>
      <div className="relative w-full overflow-hidden rounded-xl border border-border bg-[var(--surface-popover)] p-3 shadow-sm">
        <DataSourceBar payload={payload} />
        <WatchlistTabs
          instruments={instruments}
          activeIndex={safeIndex}
          onSelect={setActiveIndex}
        />
        <StockChartWidget
          payload={payload}
          activeInstrument={activeInstrument}
          showZoom
          onZoom={() => setZoomOpen(true)}
        />
        {payload.attribution && !payload.dataSourceLabel ? (
          <div className="mt-2 text-right text-[11px] text-text-muted">{payload.attribution}</div>
        ) : null}
      </div>
      <Modal
        open={zoomOpen}
        title={activeInstrument.name || activeInstrument.symbol || "查看图表"}
        onClose={() => setZoomOpen(false)}
        panelClassName="w-[92vw] max-w-5xl bg-surface-popover"
      >
        <ZoomableViewport stageWidth={900} viewportHeight="75vh">
          <div className="p-2">
            <WatchlistTabs
              instruments={instruments}
              activeIndex={safeIndex}
              onSelect={setActiveIndex}
            />
            <StockChartWidget
              payload={payload}
              activeInstrument={activeInstrument}
              height={480}
            />
          </div>
        </ZoomableViewport>
      </Modal>
    </>
  );
}
