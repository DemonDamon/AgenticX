"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  toast,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { adminFetch } from "../../../lib/admin-client-auth";
import type { GraphEdge, GraphNode } from "../../../lib/graph-store-types";
import GraphExplorerCanvas from "../../../components/graph-explorer-canvas";

export default function AdminGraphExplorerSection() {
  const t = useTranslations("pages.admin.graphExplorer");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [backend, setBackend] = useState<string>("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [neighborhoodNodes, setNeighborhoodNodes] = useState<GraphNode[]>([]);
  const [focusNote, setFocusNote] = useState("");
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const focusId = (searchParams.get("focus") || "").trim();
  const [busy, setBusy] = useState(false);

  const loadSubgraph = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, statsRes] = await Promise.all([
        adminFetch("/api/admin/graph-explorer/subgraph"),
        adminFetch("/api/admin/graph-explorer/stats"),
      ]);
      if (!subRes.ok) throw new Error(`HTTP ${subRes.status}`);
      const subJson = (await subRes.json()) as {
        data?: { nodes?: GraphNode[]; edges?: GraphEdge[]; backend?: string };
      };
      const statsJson = statsRes.ok
        ? ((await statsRes.json()) as { data?: { backend?: string; stats?: { backend?: string } } })
        : null;
      setNodes(subJson.data?.nodes ?? []);
      setEdges(subJson.data?.edges ?? []);
      setBackend(
        subJson.data?.backend ||
          statsJson?.data?.backend ||
          statsJson?.data?.stats?.backend ||
          "",
      );
    } catch (err) {
      setNodes([]);
      setEdges([]);
      toast.error(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadSubgraph();
  }, [loadSubgraph]);

  useEffect(() => {
    if (loading || !focusId || nodes.length === 0) return;
    const hit = nodes.find((n) => n.id === focusId);
    if (hit) {
      setFocusNote("");
      void onSelectNode(hit);
    } else {
      setFocusNote(t("focusEmpty"));
      // still try neighborhood API for entities not in current subgraph viewport
      void onSelectNode({
        id: focusId,
        name: focusId,
        entity_type: "unknown",
        description: null,
        attributes: {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once per load/focusId
  }, [loading, focusId, nodes]);

  async function doSeed() {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/graph-explorer/seed", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { data?: { backend?: string } };
      if (json.data?.backend) setBackend(json.data.backend);
      toast.success(t("seedSuccess"));
      await loadSubgraph();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("seedFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function onSelectNode(node: GraphNode | null) {
    setSelected(node);
    if (!node) {
      setNeighborhoodNodes([]);
      return;
    }
    try {
      const res = await adminFetch(
        `/api/admin/graph-explorer/neighborhood?id=${encodeURIComponent(node.id)}&depth=1`,
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        data?: { nodes?: GraphNode[]; backend?: string };
      };
      const neighbors = json.data?.nodes ?? [];
      setNeighborhoodNodes(neighbors);
      const center = neighbors.find((n) => n.id === node.id);
      if (center) setSelected(center);
      if (json.data?.backend) setBackend(json.data.backend);
    } catch {
      // keep clicked node
    }
  }

  return (
    <div className="space-y-6" data-testid="graph-explorer-page">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="graph-explorer-seed"
          variant="secondary"
          disabled={busy}
          onClick={() => void doSeed()}
        >
          {t("seed")}
        </Button>
        <Button
          data-testid="graph-explorer-refresh"
          variant="ghost"
          disabled={busy}
          onClick={() => void loadSubgraph()}
        >
          {t("refresh")}
        </Button>
        <Link
          href="/admin/graph-incremental"
          className="text-sm text-muted-foreground underline"
          data-testid="graph-explorer-link-incremental"
        >
          {t("linkIncremental")}
        </Link>
      </div>

      <p
        className="text-sm text-muted-foreground"
        data-testid="graph-explorer-backend"
      >
        {t("backendLabel")}:{" "}
        <code data-testid="graph-explorer-backend-value">{backend || "—"}</code>
        {" · "}
        {t("sotNote")}
      </p>
      {focusNote ? (
        <p className="text-sm text-amber-700" data-testid="graph-explorer-focus-note">
          {focusNote}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card data-testid="graph-explorer-canvas-card">
          <CardHeader>
            <CardTitle>{t("canvasTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : nodes.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="graph-explorer-empty">
                {t("empty")}
              </p>
            ) : (
              <GraphExplorerCanvas
                nodes={nodes}
                edges={edges}
                selectedId={selected?.id}
                onSelect={(n) => void onSelectNode(n)}
              />
            )}
          </CardContent>
        </Card>

        <Card data-testid="graph-explorer-detail">
          <CardHeader>
            <CardTitle>{t("detailTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {selected ? (
              <>
                <div data-testid="graph-explorer-detail-id">
                  <span className="text-muted-foreground">{t("col.id")}: </span>
                  <span className="font-mono text-xs">{selected.id}</span>
                </div>
                <div data-testid="graph-explorer-detail-name">
                  <span className="text-muted-foreground">{t("col.name")}: </span>
                  {selected.name}
                </div>
                <div>
                  <span className="text-muted-foreground">{t("col.type")}: </span>
                  {selected.entity_type}
                </div>
                {selected.description ? (
                  <div>
                    <span className="text-muted-foreground">{t("col.description")}: </span>
                    {selected.description}
                  </div>
                ) : null}
                <pre
                  className="overflow-auto rounded border bg-muted/30 p-2 font-mono text-xs"
                  data-testid="graph-explorer-detail-attrs"
                >
                  {JSON.stringify(selected.attributes ?? {}, null, 2)}
                </pre>

                <div className="pt-2" data-testid="graph-explorer-neighborhood">
                  <div className="mb-1 font-medium">{t("neighborhoodTitle")}</div>
                  {neighborhoodNodes.length === 0 ? (
                    <p className="text-muted-foreground">{t("neighborhoodEmpty")}</p>
                  ) : (
                    <ul className="space-y-1 font-mono text-xs">
                      {neighborhoodNodes.map((n) => (
                        <li key={n.id} data-testid={`graph-explorer-neighbor-${n.id}`}>
                          {n.id}
                          {n.name ? ` · ${n.name}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{t("noSelection")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
