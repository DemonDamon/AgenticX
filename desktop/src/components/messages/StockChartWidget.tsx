import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { Maximize2 } from "lucide-react";
import { Modal } from "../ds/Modal";
import { ZoomableViewport } from "../ds/ZoomableViewport";
import { buildStockChartOption } from "./stock-chart-options";
import type { StockChartPayload } from "./widget-preview";

type Props = {
  payload: StockChartPayload;
  height?: number;
  showZoom?: boolean;
  onZoom?: () => void;
};

export function StockChartWidget({ payload, height = 340, showZoom = false, onZoom }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const chart = echarts.init(node, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const render = () => {
      const option = buildStockChartOption(payload);
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
  }, [payload]);

  return (
    <div className="relative w-full min-w-0">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {payload.title ? (
            <div className="truncate text-[13px] font-medium text-text-strong">{payload.title}</div>
          ) : null}
          {truncated ? (
            <div className="mt-0.5 text-[11px] text-amber-500/90">已收起早期数据，仅展示最近 500 条</div>
          ) : null}
        </div>
        {payload.attribution ? (
          <span className="shrink-0 text-right text-[11px] leading-snug text-text-muted">
            {payload.attribution}
          </span>
        ) : null}
      </div>
      <div
        ref={ref}
        className="w-full rounded-md border border-border bg-surface-card"
        style={{ height }}
      />
      {showZoom && onZoom ? (
        <button
          type="button"
          onClick={onZoom}
          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded border border-border bg-[var(--surface-popover)] text-text-faint shadow-sm transition hover:bg-[var(--surface-card-strong)] hover:text-text-subtle"
          title="放大查看"
        >
          <Maximize2 size={13} />
        </button>
      ) : null}
    </div>
  );
}

export function StockChartWidgetBlock({ payload }: { payload: StockChartPayload }) {
  const [zoomOpen, setZoomOpen] = useState(false);

  return (
    <>
      <div className="relative w-full overflow-hidden rounded-md border border-border bg-[var(--surface-popover)] p-2">
        <StockChartWidget payload={payload} showZoom onZoom={() => setZoomOpen(true)} />
      </div>
      <Modal
        open={zoomOpen}
        title={payload.title || "查看图表"}
        onClose={() => setZoomOpen(false)}
        panelClassName="w-[92vw] max-w-5xl bg-surface-popover"
      >
        <ZoomableViewport stageWidth={900} viewportHeight="75vh">
          <StockChartWidget payload={payload} height={520} />
        </ZoomableViewport>
      </Modal>
    </>
  );
}
