import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdgeDTO, GraphNodeDTO } from "./memory-graph-types";

type Props = {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  width?: number;
  height?: number;
  className?: string;
};

const KIND_COLOR: Record<string, string> = {
  entity: "#60a5fa",
  episode: "#94a3b8",
  community: "#a78bfa",
};

function MemoryGraphCanvasInner({
  nodes,
  edges,
  selectedId,
  onSelect,
  width: widthProp,
  height: heightProp,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: widthProp ?? 640, height: heightProp ?? 420 });
  const simRef = useRef<
    Array<{ id: string; x: number; y: number; vx: number; vy: number; kind: string; label: string }>
  >([]);
  const hoverRef = useRef<string | null>(null);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const width = widthProp ?? size.width;
  const height = heightProp ?? size.height;

  useEffect(() => {
    if (widthProp != null && heightProp != null) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0) setSize({ width: Math.floor(w), height: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthProp, heightProp]);

  useEffect(() => {
    const cx = width / 2;
    const cy = height / 2;
    simRef.current = nodes.map((n, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const r = Math.min(width, height) * 0.32;
      return {
        id: n.id,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        kind: n.kind,
        label: n.label,
      };
    });
  }, [nodes, width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let alive = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    const tick = () => {
      if (!alive) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pts = simRef.current;
      const cx = width / 2;
      const cy = height / 2;
      for (const p of pts) {
        p.vx += (cx - p.x) * 0.0018;
        p.vy += (cy - p.y) * 0.0018;
        p.vx *= 0.88;
        p.vy *= 0.88;
        p.x += p.vx;
        p.y += p.vy;
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 1400 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          pts[i].vx += fx;
          pts[i].vy += fy;
          pts[j].vx -= fx;
          pts[j].vy -= fy;
        }
      }
      for (const edge of edges) {
        const s = pts.find((p) => p.id === edge.source);
        const t = pts.find((p) => p.id === edge.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.025;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        s.vx += fx;
        s.vy += fy;
        t.vx -= fx;
        t.vy -= fy;
      }

      ctx.clearRect(0, 0, width, height);
      const step = 28;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.045)";
      ctx.lineWidth = 1;
      for (let x = step; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = step; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const highlight = selectedId || hoverRef.current;
      for (const edge of edges) {
        const s = pts.find((p) => p.id === edge.source);
        const t = pts.find((p) => p.id === edge.target);
        if (!s || !t) continue;
        const active = highlight === edge.source || highlight === edge.target;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        if (edge.status === "invalidated") {
          ctx.strokeStyle = active ? "rgba(148,163,184,0.5)" : "rgba(148,163,184,0.22)";
          ctx.setLineDash([4, 5]);
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = active ? "rgba(129,180,255,0.85)" : "rgba(96,165,250,0.32)";
          ctx.setLineDash([]);
          ctx.lineWidth = active ? 1.6 : 1.1;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.lineCap = "round";
      for (const p of pts) {
        const isSel = selectedId === p.id;
        const isHover = hoverRef.current === p.id;
        const base = 6 + Math.min(nodeMap.get(p.id)?.label.length ?? 0, 20) * 0.06;
        const r = isSel ? base + 4 : isHover ? base + 2 : base;
        const color = KIND_COLOR[p.kind] || "#64748b";
        if (isSel || isHover) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + (isSel ? 7 : 5), 0, Math.PI * 2);
          ctx.fillStyle = `${color}22`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isSel
          ? "rgba(248,250,252,0.95)"
          : isHover
            ? "rgba(248,250,252,0.6)"
            : "rgba(15,23,42,0.55)";
        ctx.stroke();
      }

      if (highlight) {
        const p = pts.find((pt) => pt.id === highlight);
        const meta = nodeMap.get(highlight);
        if (p && meta) {
          const label = meta.label.length > 28 ? `${meta.label.slice(0, 26)}…` : meta.label;
          ctx.font = "11px system-ui, sans-serif";
          const tw = ctx.measureText(label).width;
          const pad = 6;
          const bx = Math.min(Math.max(p.x - tw / 2 - pad, 4), width - tw - pad * 2 - 4);
          const by = Math.max(p.y - 28, 4);
          ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
          ctx.strokeStyle = "rgba(96, 165, 250, 0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx, by, tw + pad * 2, 20, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText(label, bx + pad, by + 14);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [edges, width, height, selectedId, nodeMap]);

  const pickNode = (clientX: number, clientY: number, rect: DOMRect) => {
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: string | null = null;
    let bestD = 9999;
    for (const p of simRef.current) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 18 && d < bestD) {
        bestD = d;
        best = p.id;
      }
    }
    return best;
  };

  const handleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    onSelect(pickNode(ev.clientX, ev.clientY, rect));
  };

  const handleMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    hoverRef.current = pickNode(ev.clientX, ev.clientY, rect);
  };

  const canvas = (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="block h-full w-full cursor-pointer"
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => {
        hoverRef.current = null;
      }}
    />
  );

  if (className) {
    return (
      <div ref={containerRef} className={className}>
        {canvas}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="cursor-pointer rounded-md bg-surface-card/40"
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => {
        hoverRef.current = null;
      }}
    />
  );
}

export const MemoryGraphCanvas = memo(MemoryGraphCanvasInner);
