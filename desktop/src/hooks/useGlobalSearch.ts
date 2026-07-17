import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GlobalSearchCategory =
  | "all"
  | "documents"
  | "applications"
  | "images"
  | "folders"
  | "videos"
  | "conversations";

export type GlobalSearchItem = {
  path: string;
  name: string;
  ext: string;
  kind: "folder" | "document" | "application" | "image" | "video" | "other";
  size: number;
  mtime: number;
};

/** A chat-history hit surfaced under the "对话" category tab. */
export type ConversationHit = {
  sessionId: string;
  avatarId: string | null;
  avatarName: string;
  title: string;
  snippet: string;
  updatedAt: number;
  provider?: string;
  model?: string;
};

export type GlobalSearchPreview = {
  ok: boolean;
  kind: "text" | "image" | "metadata";
  content?: string;
  fileUrl?: string;
  truncated?: boolean;
  error?: string;
};

const HISTORY_KEY = "near:global-search:history-v1";
const DEBOUNCE_MS = 300;

export const CATEGORY_TABS: Array<{ id: GlobalSearchCategory; label: string }> = [
  { id: "all", label: "综合" },
  { id: "documents", label: "文档" },
  { id: "applications", label: "应用" },
  { id: "images", label: "图片" },
  { id: "folders", label: "文件夹" },
  { id: "videos", label: "视频" },
  { id: "conversations", label: "对话" },
];

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 5);
  } catch {
    return [];
  }
}

function writeHistory(items: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 5)));
  } catch {
    // ignore quota errors
  }
}

export function kindGroupLabel(kind: GlobalSearchItem["kind"]): string {
  switch (kind) {
    case "folder":
      return "文件夹";
    case "document":
      return "文档";
    case "application":
      return "应用";
    case "image":
      return "图片";
    case "video":
      return "视频";
    default:
      return "其他";
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export function formatMtime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function useGlobalSearch(open: boolean) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GlobalSearchCategory>("all");
  const [results, setResults] = useState<GlobalSearchItem[]>([]);
  const [conversationResults, setConversationResults] = useState<ConversationHit[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [history, setHistory] = useState<string[]>(() => readHistory());
  const [preview, setPreview] = useState<GlobalSearchPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const reqIdRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const searchStartedAtRef = useRef(0);

  const categoryCounts = useMemo(() => {
    const counts: Record<GlobalSearchCategory, number> = {
      all: results.length,
      documents: 0,
      applications: 0,
      images: 0,
      folders: 0,
      videos: 0,
      conversations: conversationResults.length,
    };
    for (const item of results) {
      if (item.kind === "folder") counts.folders += 1;
      if (item.kind === "document") counts.documents += 1;
      if (item.kind === "application") counts.applications += 1;
      if (item.kind === "image") counts.images += 1;
      if (item.kind === "video") counts.videos += 1;
    }
    return counts;
  }, [results, conversationResults]);

  const visibleResults = useMemo(() => {
    if (category === "all") return results;
    if (category === "folders") return results.filter((item) => item.kind === "folder");
    if (category === "documents") return results.filter((item) => item.kind === "document");
    if (category === "applications") return results.filter((item) => item.kind === "application");
    if (category === "images") return results.filter((item) => item.kind === "image");
    if (category === "videos") return results.filter((item) => item.kind === "video");
    return results;
  }, [results, category]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, GlobalSearchItem[]>();
    for (const item of visibleResults) {
      const label = kindGroupLabel(item.kind);
      const bucket = groups.get(label) ?? [];
      bucket.push(item);
      groups.set(label, bucket);
    }
    return Array.from(groups.entries());
  }, [visibleResults]);

  const selectedItem = useMemo(
    () =>
      visibleResults.find((item) => item.path === selectedPath) ??
      results.find((item) => item.path === selectedPath) ??
      null,
    [results, visibleResults, selectedPath]
  );

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    stopElapsedTimer();
    searchStartedAtRef.current = Date.now();
    setElapsedMs(0);
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - searchStartedAtRef.current);
    }, 100);
  }, [stopElapsedTimer]);

  const resetState = useCallback(() => {
    reqIdRef.current += 1;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    stopElapsedTimer();
    setQuery("");
    setCategory("all");
    setResults([]);
    setConversationResults([]);
    setSelectedPath(null);
    setLoading(false);
    setError(null);
    setWarning(null);
    setTimedOut(false);
    setElapsedMs(0);
    setPreview(null);
    setPreviewLoading(false);
  }, [stopElapsedTimer]);

  const pushHistory = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 5);
      writeHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    writeHistory([]);
    setHistory([]);
  }, []);

  const runSearch = useCallback(
    async (nextQuery: string, nextCategory: GlobalSearchCategory) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) {
        setResults([]);
        setConversationResults([]);
        setSelectedPath(null);
        setError(null);
        setWarning(null);
        setTimedOut(false);
        setLoading(false);
        stopElapsedTimer();
        setElapsedMs(0);
        return;
      }

      // "对话" tab → search chat history via backend FTS, resolve titles/avatars
      // from the session list so results can jump straight to the conversation.
      if (nextCategory === "conversations") {
        const reqId = ++reqIdRef.current;
        setLoading(true);
        setError(null);
        setWarning(null);
        setTimedOut(false);
        startElapsedTimer();
        try {
          const [sres, lres] = await Promise.all([
            window.agenticxDesktop.searchSessions({ q: trimmed }),
            window.agenticxDesktop.listSessions(),
          ]);
          if (reqId !== reqIdRef.current) return;
          if (!sres.ok) {
            setConversationResults([]);
            setError(sres.error ?? "对话搜索失败，请稍后重试");
            return;
          }
          const rowsById = new Map<string, (typeof lres.sessions)[number]>();
          if (lres.ok && Array.isArray(lres.sessions)) {
            for (const r of lres.sessions) rowsById.set(r.session_id, r);
          }
          const hits = Array.isArray(sres.hits) ? sres.hits : [];
          const mapped: ConversationHit[] = [];
          for (const h of hits) {
            const sid = String(h.session_id || "").trim();
            if (!sid) continue;
            const row = rowsById.get(sid);
            const avatarId = row?.avatar_id ?? null;
            if (typeof avatarId === "string" && avatarId.startsWith("automation:")) continue;
            const rawName = String(row?.session_name || "").trim();
            const title = rawName || `·${sid.replace(/-/g, "").slice(0, 8)}`;
            mapped.push({
              sessionId: sid,
              avatarId,
              avatarName: String(row?.avatar_name || "").trim(),
              title,
              snippet: String(h.snippet || "").trim(),
              updatedAt: Number(row?.updated_at || 0),
              provider: row?.provider,
              model: row?.model,
            });
          }
          mapped.sort((a, b) => b.updatedAt - a.updatedAt);
          setConversationResults(mapped);
        } catch (err) {
          if (reqId !== reqIdRef.current) return;
          setConversationResults([]);
          setError(String(err));
        } finally {
          if (reqId === reqIdRef.current) {
            setLoading(false);
            stopElapsedTimer();
          }
        }
        return;
      }

      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);
      setWarning(null);
      setTimedOut(false);
      startElapsedTimer();

      try {
        const resp = await window.agenticxDesktop.systemSearch({
          query: trimmed,
          category: nextCategory as Exclude<GlobalSearchCategory, "conversations">,
        });
        if (reqId !== reqIdRef.current) return;

        if (!resp.ok) {
          setResults([]);
          setSelectedPath(null);
          setError(resp.error ?? "搜索失败，请稍后重试");
          return;
        }

        setResults(resp.items);
        setSelectedPath(resp.items[0]?.path ?? null);
        setWarning(resp.warning ?? null);
        setTimedOut(Boolean(resp.timedOut));
        if (resp.timedOut) {
          setError("搜索超时（5s），请缩小关键词");
        } else if (resp.error) {
          setError(resp.error);
        }
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setResults([]);
        setSelectedPath(null);
        setError(String(err));
      } finally {
        if (reqId === reqIdRef.current) {
          setLoading(false);
          stopElapsedTimer();
        }
      }
    },
    [startElapsedTimer, stopElapsedTimer]
  );

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    setHistory(readHistory());
  }, [open, resetState]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      debounceRef.current = null;
      reqIdRef.current += 1;
      setResults([]);
      setConversationResults([]);
      setSelectedPath(null);
      setLoading(false);
      setError(null);
      setWarning(null);
      setTimedOut(false);
      stopElapsedTimer();
      setElapsedMs(0);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(trimmed, category);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [open, query, category, runSearch, stopElapsedTimer]);

  useEffect(() => {
    if (visibleResults.some((item) => item.path === selectedPath)) return;
    const next = visibleResults[0]?.path ?? null;
    setSelectedPath((prev) => (prev === next ? prev : next));
  }, [visibleResults, selectedPath]);

  useEffect(() => {
    if (!open || !selectedPath) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    void window.agenticxDesktop
      .systemSearchPreview(selectedPath)
      .then((resp) => {
        if (cancelled) return;
        setPreview(resp);
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview({ ok: false, kind: "metadata", error: String(err) });
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedPath]);

  const submitQuery = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setQuery(trimmed);
      if (trimmed) pushHistory(trimmed);
    },
    [pushHistory]
  );

  const openSelected = useCallback(async () => {
    if (!selectedPath) return;
    await window.agenticxDesktop.systemSearchOpen(selectedPath);
  }, [selectedPath]);

  const revealSelected = useCallback(async () => {
    if (!selectedPath) return;
    await window.agenticxDesktop.systemSearchReveal(selectedPath);
  }, [selectedPath]);

  return {
    query,
    setQuery,
    category,
    setCategory,
    results,
    selectedPath,
    setSelectedPath,
    selectedItem,
    loading,
    error,
    warning,
    timedOut,
    elapsedMs,
    history,
    clearHistory,
    submitQuery,
    pushHistory,
    preview,
    previewLoading,
    categoryCounts,
    groupedResults,
    conversationResults,
    openSelected,
    revealSelected,
  };
}
