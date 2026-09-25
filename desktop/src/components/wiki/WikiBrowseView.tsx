import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { useAppStore } from "../../store";
import { createBrainsApi, type BrainRecord } from "../settings/brains/api";
import { displayBrainName } from "../settings/brains/brain-display";
import { createKbApi, type KBApi } from "../settings/knowledge/api";

type WikiPage = { path: string; title: string; type: string };
type WikiNode = { id: string; title: string; type: string; path: string; sources: string[] };
type WikiEdge = { source: string; target: string };
type TreeFolder = { kind: "folder"; key: string; name: string; children: TreeItem[] };
type TreeLeaf = { kind: "page"; page: WikiPage };
type TreeItem = TreeFolder | TreeLeaf;

const TYPE_COLOR: Record<string, string> = {
  summary: "#3b82f6",
  entity: "#22c55e",
  concept: "#f97316",
  synthesis: "#14b8a6",
  comparison: "#ef4444",
  page: "#94a3b8",
};

function typeColor(type: string): string {
  return TYPE_COLOR[type] ?? TYPE_COLOR.page;
}

function pageId(path: string): string {
  return path.replace(/\\/g, "/").replace(/^wiki\//, "").replace(/\.md$/, "");
}

function parsePage(raw: string): { body: string; sources: string[] } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: raw, sources: [] };
  const sources: string[] = [];
  const block = match[1].match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (block) {
    for (const line of block[1].split("\n")) {
      const item = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/);
      if (item) sources.push(item[1].trim());
    }
  }
  return { body: raw.slice(match[0].length), sources };
}

function wikiMarkdown(body: string): string {
  return body.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_full, target: string, label?: string) => {
    const token = target.trim();
    const text = (label || token).trim();
    return `[${text}](#wiki/${encodeURIComponent(token)})`;
  });
}

function buildTree(pages: WikiPage[]): TreeItem[] {
  const root: TreeItem[] = [];
  for (const page of pages) {
    const parts = pageId(page.path).split("/").filter(Boolean);
    let level = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (!isLeaf) {
        const key = parts.slice(0, i + 1).join("/");
        let folder = level.find((item): item is TreeFolder => item.kind === "folder" && item.key === key);
        if (!folder) {
          folder = { kind: "folder", key, name: part.replace(/[-_]/g, " "), children: [] };
          level.push(folder);
        }
        level = folder.children;
      } else {
        level.push({ kind: "page", page });
      }
    }
  }
  return root;
}

async function graphFromPages(
  api: KBApi,
  pageList: WikiPage[],
): Promise<{ nodes: WikiNode[]; edges: WikiEdge[] }> {
  const contents = await Promise.all(
    pageList.map(async (page) => ({ page, raw: await api.getWikiPage(page.path).catch(() => "") })),
  );
  const nodes: WikiNode[] = contents.map(({ page, raw }) => {
    const parsed = parsePage(raw);
    return {
      id: pageId(page.path),
      title: page.title,
      type: page.type,
      path: page.path,
      sources: parsed.sources,
    };
  });
  const known = new Set(nodes.map((node) => node.id));
  const edges: WikiEdge[] = [];
  for (const { page, raw } of contents) {
    const source = pageId(page.path);
    for (const match of parsePage(raw).body.matchAll(/\[\[([^\]|]+)/g)) {
      const target = match[1].trim().replace(/\.md$/, "");
      if (known.has(target)) edges.push({ source, target });
    }
  }
  return { nodes, edges };
}

function resolvePage(pages: WikiPage[], token: string): WikiPage | undefined {
  const needle = token.replace(/\.md$/, "").trim().toLowerCase();
  return pages.find((page) => {
    const id = pageId(page.path).toLowerCase();
    return id === needle || id.endsWith(`/${needle}`) || page.title.toLowerCase() === needle;
  });
}

export function WikiBrowseView() {
  const { t } = useTranslation("sidebar");
  const apiToken = useAppStore((s) => s.apiToken);
  const apiBase = useAppStore((s) => s.apiBase);
  const openSettings = useAppStore((s) => s.openSettings);
  const resolveApiBase = useCallback(async () => {
    const configured = (apiBase ?? "").trim();
    if (configured) return configured.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [apiBase]);
  const brainsApi = useMemo(
    () => createBrainsApi(apiToken, resolveApiBase),
    [apiToken, resolveApiBase],
  );

  const [brains, setBrains] = useState<BrainRecord[]>([]);
  const [brainId, setBrainId] = useState<string | null>(null);
  const [mode, setMode] = useState<"pages" | "graph">("pages");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [nodes, setNodes] = useState<WikiNode[]>([]);
  const [edges, setEdges] = useState<WikiEdge[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [purposeDraft, setPurposeDraft] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kbApi: KBApi | null = useMemo(() => {
    if (!brainId) return null;
    return createKbApi(
      apiToken,
      async () => {
        const base = await resolveApiBase();
        return `${base}/api/brains/${encodeURIComponent(brainId)}`;
      },
      "brain",
    );
  }, [apiToken, brainId, resolveApiBase]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = (await brainsApi.list()).filter((brain) => brain.type === "docs");
        if (cancelled) return;
        setBrains(list);
        setBrainId((current) => current ?? list[0]?.id ?? null);
      } catch (exc) {
        if (!cancelled) setError(String((exc as Error).message ?? exc));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brainsApi]);

  useEffect(() => {
    if (!kbApi) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [pageList, purposeText] = await Promise.all([kbApi.listWikiPages(), kbApi.getPurpose()]);
        if (cancelled) return;
        let graphNodes: WikiNode[] = [];
        let graphEdges: WikiEdge[] = [];
        try {
          const graph = await kbApi.getWikiGraph();
          graphNodes = graph.nodes;
          graphEdges = graph.edges;
        } catch {
          const built = await graphFromPages(kbApi, pageList);
          graphNodes = built.nodes;
          graphEdges = built.edges;
        }
        if (cancelled) return;
        setPages(pageList);
        setNodes(graphNodes);
        setEdges(graphEdges);
        setPurpose(purposeText);
        setPurposeDraft(purposeText);
        setSelectedPath((current) =>
          current && pageList.some((page) => page.path === current) ? current : pageList[0]?.path ?? null,
        );
        setSelectedNodeId((current) =>
          current && graphNodes.some((node) => node.id === current) ? current : graphNodes[0]?.id ?? null,
        );
      } catch (exc) {
        if (!cancelled) setError(String((exc as Error).message ?? exc));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kbApi, reloadKey]);

  useEffect(() => {
    if (!kbApi || !selectedPath) {
      setPreview("");
      setSources([]);
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    void (async () => {
      try {
        const content = await kbApi.getWikiPage(selectedPath);
        if (cancelled) return;
        const parsed = parsePage(content);
        setPreview(wikiMarkdown(parsed.body));
        setSources(parsed.sources);
      } catch (exc) {
        if (!cancelled) setPreview(String((exc as Error).message ?? exc));
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kbApi, selectedPath]);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (page) => page.title.toLowerCase().includes(q) || page.path.toLowerCase().includes(q),
    );
  }, [pages, query]);
  const tree = useMemo(() => buildTree(filteredPages), [filteredPages]);
  const selectedPage = pages.find((page) => page.path === selectedPath) ?? null;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  const linkedPages = useMemo(() => {
    const id = selectedPage ? pageId(selectedPage.path) : "";
    const targets = new Set(edges.filter((edge) => edge.source === id).map((edge) => edge.target));
    return pages.filter((page) => targets.has(pageId(page.path)));
  }, [edges, pages, selectedPage]);

  const flow = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? nodes.filter((node) => node.title.toLowerCase().includes(q) || node.path.toLowerCase().includes(q))
      : nodes;
    const visibleIds = new Set(visible.map((node) => node.id));
    const byType = new Map<string, WikiNode[]>();
    for (const node of visible) {
      const list = byType.get(node.type) ?? [];
      list.push(node);
      byType.set(node.type, list);
    }
    const flowNodes: Node[] = [];
    [...byType.keys()].forEach((type, column) => {
      (byType.get(type) ?? []).forEach((node, row) => {
        const color = typeColor(node.type);
        flowNodes.push({
          id: node.id,
          position: { x: column * 220, y: row * 78 },
          data: { label: node.title },
          style: {
            background: "var(--color-surface-card, #1c1c1f)",
            color: "var(--color-text-strong, #f4f4f5)",
            border: `1.5px solid ${color}`,
            borderRadius: 14,
            fontSize: 12,
            width: 168,
            padding: "8px 10px",
          },
        });
      });
    });
    const flowEdges: Edge[] = edges
      .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
      .map((edge) => ({
        id: `${edge.source}->${edge.target}`,
        source: edge.source,
        target: edge.target,
        style: { stroke: "#94a3b8" },
      }));
    return { flowNodes, flowEdges };
  }, [edges, nodes, query]);

  function openToken(token: string) {
    const page = resolvePage(pages, decodeURIComponent(token));
    if (!page) return;
    setMode("pages");
    setSelectedPath(page.path);
  }

  async function createSample() {
    if (!kbApi) return;
    setCreating(true);
    setError(null);
    try {
      await kbApi.createSampleWiki();
      setReloadKey((value) => value + 1);
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setCreating(false);
    }
  }

  async function savePurpose() {
    if (!kbApi) return;
    await kbApi.savePurpose(purposeDraft);
    setPurpose(purposeDraft);
  }

  function typeLabel(type: string): string {
    const key = `wiki.type.${type}`;
    const label = t(key);
    return label === key ? type : label;
  }

  function renderTree(items: TreeItem[], depth: number) {
    return items.map((item) => {
      if (item.kind === "folder") {
        const open = !collapsed[item.key];
        return (
          <div key={item.key}>
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[13px] text-text-muted hover:bg-surface-hover"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => setCollapsed((state) => ({ ...state, [item.key]: !state[item.key] }))}
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span className="truncate">{item.name}</span>
            </button>
            {open ? renderTree(item.children, depth + 1) : null}
          </div>
        );
      }
      const active = item.page.path === selectedPath;
      return (
        <button
          key={item.page.path}
          type="button"
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] ${
            active ? "bg-surface-card-strong text-text-strong" : "text-text-muted hover:bg-surface-hover"
          }`}
          style={{ paddingLeft: 22 + depth * 14 }}
          onClick={() => setSelectedPath(item.page.path)}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: typeColor(item.page.type) }} />
          <span className="truncate">{item.page.title || item.page.path}</span>
        </button>
      );
    });
  }

  const brain = brains.find((item) => item.id === brainId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="text-text-muted">{t("nav.wiki")}</span>
          <span className="text-text-faint">/</span>
          <select
            className="max-w-[240px] truncate bg-transparent text-sm font-medium text-text-strong outline-none"
            value={brainId ?? ""}
            onChange={(event) => {
              setBrainId(event.target.value || null);
              setSelectedPath(null);
              setSelectedNodeId(null);
            }}
          >
            {brains.map((item) => (
              <option key={item.id} value={item.id}>
                {displayBrainName(item)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-surface-card p-0.5">
          {(["pages", "graph"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded-md px-3 py-1 text-xs ${
                mode === item ? "bg-surface-card-strong font-medium text-text-strong" : "text-text-muted"
              }`}
              onClick={() => setMode(item)}
            >
              {t(item === "pages" ? "wiki.pages" : "wiki.graph")}
            </button>
          ))}
        </div>
        <label className="ml-auto flex min-w-[180px] items-center gap-1.5 rounded-md border border-border bg-surface-card px-2 py-1 text-text-muted">
          <Search className="h-3.5 w-3.5" />
          <input
            className="w-full bg-transparent text-xs text-text-strong outline-none"
            value={query}
            placeholder={t("wiki.search")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="text-xs text-text-muted hover:text-text-strong"
          onClick={() => setPurposeOpen((open) => !open)}
        >
          {t("wiki.purpose")}
        </button>
      </header>
      {purposeOpen ? (
        <div className="border-b border-border px-4 py-3">
          <textarea
            className="min-h-[72px] w-full resize-y rounded-md border border-border bg-surface-card px-2 py-1.5 text-xs text-text-strong"
            value={purposeDraft}
            onChange={(event) => setPurposeDraft(event.target.value)}
          />
          <button
            type="button"
            className="mt-2 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1 text-xs font-medium text-[var(--ui-btn-primary-text)] disabled:opacity-50"
            disabled={!kbApi || purposeDraft === purpose}
            onClick={() => void savePurpose()}
          >
            {t("wiki.savePurpose")}
          </button>
        </div>
      ) : null}
      {error ? <p className="px-4 py-3 text-xs text-rose-400">{error}</p> : null}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("wiki.loading")}
        </div>
      ) : brains.length === 0 ? (
        <EmptyState
          text={t("wiki.emptyBrains")}
          action={t("wiki.openKnowledge")}
          onAction={() => openSettings("knowledge")}
        />
      ) : pages.length === 0 ? (
        <EmptyState
          text={t("wiki.howTo")}
          action={t("wiki.createSample")}
          onAction={() => void createSample()}
          secondary={t("wiki.openKnowledge")}
          onSecondary={() => openSettings("knowledge")}
          busy={creating}
        />
      ) : mode === "pages" ? (
        <div className="flex min-h-0 flex-1">
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-border p-2">
            {renderTree(tree, 0)}
          </aside>
          <article className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
            {pageLoading ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("wiki.loading")}
              </div>
            ) : (
              <>
                {selectedPage ? (
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] text-white"
                      style={{ background: typeColor(selectedPage.type) }}
                    >
                      {typeLabel(selectedPage.type)}
                    </span>
                    <span className="text-xs text-text-faint">{brain ? displayBrainName(brain) : ""}</span>
                  </div>
                ) : null}
                <div className="prose prose-sm max-w-none text-text-primary dark:prose-invert">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    urlTransform={(url) => url}
                    components={{
                      a: ({ href, children }) => {
                        if (href?.startsWith("#wiki/")) {
                          return (
                            <button
                              type="button"
                              className="text-[rgb(var(--theme-color-rgb,59,130,246))] underline"
                              onClick={() => openToken(href.slice("#wiki/".length))}
                            >
                              {children}
                            </button>
                          );
                        }
                        return (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {preview}
                  </ReactMarkdown>
                </div>
                <section className="mt-8 border-t border-border pt-4">
                  <h3 className="text-xs font-medium text-text-muted">{t("wiki.linked")}</h3>
                  {linkedPages.length === 0 ? (
                    <p className="mt-2 text-xs text-text-faint">{t("wiki.noLinks")}</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {linkedPages.map((page) => (
                        <button
                          key={page.path}
                          type="button"
                          className="rounded-full border border-border px-2.5 py-1 text-xs text-text-strong hover:bg-surface-hover"
                          onClick={() => setSelectedPath(page.path)}
                        >
                          {page.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {sources.length > 0 ? (
                    <>
                      <h3 className="mt-4 text-xs font-medium text-text-muted">{t("wiki.sources")}</h3>
                      <ul className="mt-2 space-y-1 text-xs text-text-muted">
                        {sources.map((source) => (
                          <li key={source}>{source}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </section>
              </>
            )}
          </article>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div className="absolute right-3 top-3 z-10 flex flex-wrap gap-2 rounded-lg border border-border bg-surface-card/90 px-2 py-1.5 text-[11px]">
              {Object.keys(TYPE_COLOR).map((type) => (
                <span key={type} className="inline-flex items-center gap-1 text-text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: typeColor(type) }} />
                  {typeLabel(type)}
                </span>
              ))}
            </div>
            <ReactFlowProvider>
              <div className="h-full w-full">
                <ReactFlow
                  nodes={flow.flowNodes}
                  edges={flow.flowEdges}
                  fitView
                  onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background />
                </ReactFlow>
              </div>
            </ReactFlowProvider>
          </div>
          {selectedNode ? (
            <aside className="w-80 shrink-0 overflow-y-auto border-l border-border px-4 py-5">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] text-white"
                style={{ background: typeColor(selectedNode.type) }}
              >
                {typeLabel(selectedNode.type)}
              </span>
              <h2 className="mt-3 text-lg font-semibold text-text-strong">{selectedNode.title}</h2>
              <button
                type="button"
                className="mt-3 text-xs text-[rgb(var(--theme-color-rgb,59,130,246))]"
                onClick={() => openToken(selectedNode.id)}
              >
                {t("wiki.openPage")}
              </button>
              <h3 className="mt-6 text-xs font-medium text-text-muted">{t("wiki.linked")}</h3>
              <div className="mt-2 flex flex-col gap-1">
                {edges
                  .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
                  .map((edge) => {
                    const other = edge.source === selectedNode.id ? edge.target : edge.source;
                    const page = pages.find((item) => pageId(item.path) === other);
                    return (
                      <button
                        key={`${edge.source}-${edge.target}`}
                        type="button"
                        className="text-left text-xs text-text-strong hover:underline"
                        onClick={() => setSelectedNodeId(other)}
                      >
                        {page?.title || other}
                      </button>
                    );
                  })}
              </div>
              {selectedNode.sources.length > 0 ? (
                <>
                  <h3 className="mt-6 text-xs font-medium text-text-muted">{t("wiki.sources")}</h3>
                  <ul className="mt-2 space-y-1 text-xs text-text-muted">
                    {selectedNode.sources.map((source) => (
                      <li key={source}>{source}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  text,
  action,
  onAction,
  secondary,
  onSecondary,
  busy,
}: {
  text: string;
  action: string;
  onAction: () => void;
  secondary?: string;
  onSecondary?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="max-w-lg text-sm leading-relaxed text-text-muted">{text}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-btn-primary-text)] disabled:opacity-50"
          disabled={busy}
          onClick={onAction}
        >
          {action}
        </button>
        {secondary && onSecondary ? (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-strong"
            onClick={onSecondary}
          >
            {secondary}
          </button>
        ) : null}
      </div>
    </div>
  );
}
