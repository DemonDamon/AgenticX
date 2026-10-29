"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../lib/graph-store-types";

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: string | null;
  onSelect?: (node: GraphNode | null) => void;
  width?: number;
  height?: number;
};

export default function GraphExplorerCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  width = 900,
  height = 520,
}: Props) {
  const [sim, setSim] = useState<SimNode[]>([]);
  const frame = useRef<number | null>(null);
  const dragId = useRef<string | null>(null);

  const nodeKey = useMemo(
    () => nodes.map((n) => n.id).sort().join("|") + "::" + edges.map((e) => e.id).sort().join("|"),
    [nodes, edges],
  );

  useEffect(() => {
    const cx = width / 2;
    const cy = height / 2;
    const initial: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const r = 80 + (i % 3) * 40;
      return {
        ...n,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
    });
    setSim(initial);

    let alive = true;
    let ticks = 0;
    const step = () => {
      if (!alive) return;
      ticks += 1;
      setSim((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.map((n) => ({ ...n }));
        const byId = new Map(next.map((n) => [n.id, n]));
        // repulsion
        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const a = next[i]!;
            const b = next[j]!;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let dist = Math.hypot(dx, dy) || 0.01;
            const force = 1200 / (dist * dist);
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            if (dragId.current !== a.id) {
              a.vx += dx;
              a.vy += dy;
            }
            if (dragId.current !== b.id) {
              b.vx -= dx;
              b.vy -= dy;
            }
          }
        }
        // springs
        for (const e of edges) {
          const a = byId.get(e.source_entity_id);
          const b = byId.get(e.target_entity_id);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const target = 140;
          const force = (dist - target) * 0.02;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          if (dragId.current !== a.id) {
            a.vx += fx;
            a.vy += fy;
          }
          if (dragId.current !== b.id) {
            b.vx -= fx;
            b.vy -= fy;
          }
        }
        // center gravity + damping + bounds
        for (const n of next) {
          if (dragId.current === n.id) continue;
          n.vx += (cx - n.x) * 0.005;
          n.vy += (cy - n.y) * 0.005;
          n.vx *= 0.85;
          n.vy *= 0.85;
          n.x = Math.min(width - 24, Math.max(24, n.x + n.vx));
          n.y = Math.min(height - 24, Math.max(24, n.y + n.vy));
        }
        return next;
      });
      if (ticks < 240) {
        frame.current = requestAnimationFrame(step);
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      alive = false;
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, width, height]);

  function onPointerDown(id: string, ev: React.PointerEvent) {
    dragId.current = id;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const node = sim.find((n) => n.id === id) || nodes.find((n) => n.id === id) || null;
    onSelect?.(node);
  }

  function onPointerMove(ev: React.PointerEvent) {
    if (!dragId.current) return;
    const svg = (ev.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((ev.clientX - svg.left) / svg.width) * width;
    const y = ((ev.clientY - svg.top) / svg.height) * height;
    setSim((prev) =>
      prev.map((n) =>
        n.id === dragId.current ? { ...n, x, y, vx: 0, vy: 0 } : n,
      ),
    );
  }

  function onPointerUp() {
    dragId.current = null;
  }

  const pos = new Map(sim.map((n) => [n.id, n]));

  return (
    <svg
      data-testid="graph-explorer-canvas"
      viewBox={`0 0 ${width} ${height}`}
      className="h-[520px] w-full rounded border bg-muted/20"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      role="img"
      aria-label="Graph explorer canvas"
    >
      {edges.map((e) => {
        const a = pos.get(e.source_entity_id);
        const b = pos.get(e.target_entity_id);
        if (!a || !b) return null;
        return (
          <g key={e.id} data-testid={`graph-explorer-edge-${e.id}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="currentColor"
              className="text-muted-foreground/60"
              strokeWidth={1.5}
            />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 - 6}
              className="fill-muted-foreground text-[10px]"
              textAnchor="middle"
            >
              {e.relation_type}
            </text>
          </g>
        );
      })}
      {sim.map((n) => {
        const selected = n.id === selectedId;
        return (
          <g
            key={n.id}
            data-testid={`graph-explorer-node-${n.id}`}
            transform={`translate(${n.x},${n.y})`}
            style={{ cursor: "pointer" }}
            onPointerDown={(ev) => onPointerDown(n.id, ev)}
          >
            <circle
              r={selected ? 18 : 14}
              className={selected ? "fill-primary" : "fill-background stroke-primary"}
              strokeWidth={2}
            />
            <text
              y={28}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-medium"
            >
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
