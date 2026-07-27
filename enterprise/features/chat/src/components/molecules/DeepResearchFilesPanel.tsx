"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Button,
} from "@agenticx/ui";

export type ArtifactListItem = {
  id: string;
  path: string;
  title: string;
  kind: string;
  byteSize: number;
  mimeType?: string;
};

export type DeepResearchFilesPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /** Prefetch / highlight this artifact when opening */
  focusArtifactId?: string | null;
};

type TreeNode = {
  name: string;
  path: string;
  artifact?: ArtifactListItem;
  children: TreeNode[];
};

function buildTree(artifacts: ArtifactListItem[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const artifact of artifacts) {
    const parts = artifact.path.split("/").filter(Boolean);
    let level = root;
    let acc = "";
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]!;
      acc = acc ? `${acc}/${name}` : name;
      let node = level.find((n) => n.name === name);
      if (!node) {
        node = { name, path: acc, children: [] };
        level.push(node);
      }
      if (i === parts.length - 1) node.artifact = artifact;
      level = node.children;
    }
  }
  return root;
}

function TreeView({
  nodes,
  depth,
  selectedId,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  selectedId: string | null;
  onSelect: (item: ArtifactListItem) => void;
}) {
  return (
    <ul className={depth === 0 ? "space-y-0.5" : "ml-3 space-y-0.5 border-l border-border/40 pl-2"}>
      {nodes.map((node) => (
        <li key={node.path}>
          {node.artifact ? (
            <button
              type="button"
              onClick={() => onSelect(node.artifact!)}
              className={[
                "w-full truncate rounded-md px-2 py-1.5 text-left text-xs",
                selectedId === node.artifact.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-foreground/80 hover:bg-muted/60",
              ].join(" ")}
            >
              {node.name}
            </button>
          ) : (
            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{node.name}</div>
          )}
          {node.children.length > 0 ? (
            <TreeView
              nodes={node.children}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DeepResearchFilesPanel({
  open,
  onOpenChange,
  sessionId,
  focusArtifactId = null,
}: DeepResearchFilesPanelProps) {
  const [artifacts, setArtifacts] = React.useState<ArtifactListItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/artifacts`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: { artifacts?: ArtifactListItem[] } };
        if (cancelled) return;
        const list = json.data?.artifacts ?? [];
        setArtifacts(list);
        const focus = focusArtifactId && list.find((a) => a.id === focusArtifactId);
        const first = focus ?? list.find((a) => a.kind === "report") ?? list[0] ?? null;
        if (first) setSelectedId(first.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, focusArtifactId]);

  React.useEffect(() => {
    if (!open || !selectedId) {
      setPreview("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/chat/artifacts/${encodeURIComponent(selectedId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          data?: { artifact?: { content?: string } };
        };
        if (!cancelled) setPreview(json.data?.artifact?.content ?? "");
      } catch {
        if (!cancelled) setPreview("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedId]);

  const tree = React.useMemo(() => buildTree(artifacts), [artifacts]);

  const downloadSelected = () => {
    const item = artifacts.find((a) => a.id === selectedId);
    if (!item || !preview) return;
    const blob = new Blob([preview], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.path.split("/").pop() || "artifact.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportManifest = () => {
    const blob = new Blob([JSON.stringify(artifacts, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "artifacts-manifest.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle>全部文件</SheetTitle>
          <SheetDescription className="sr-only">深度研究产物浏览</SheetDescription>
        </SheetHeader>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Button type="button" size="sm" variant="outline" onClick={downloadSelected} disabled={!preview}>
            下载当前
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={exportManifest} disabled={!artifacts.length}>
            导出清单
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(140px,38%)_1fr]">
          <div className="overflow-y-auto border-r border-border px-2 py-3">
            {loading ? <p className="px-2 text-xs text-muted-foreground">加载中…</p> : null}
            {error ? <p className="px-2 text-xs text-destructive">{error}</p> : null}
            {!loading && !error && artifacts.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">暂无产物</p>
            ) : null}
            <TreeView
              nodes={tree}
              depth={0}
              selectedId={selectedId}
              onSelect={(item) => setSelectedId(item.id)}
            />
          </div>
          <div className="overflow-y-auto px-4 py-3">
            {preview ? (
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">选择文件以预览</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
