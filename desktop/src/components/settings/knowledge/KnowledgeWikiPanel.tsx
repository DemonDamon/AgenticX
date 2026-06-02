import { useCallback, useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { Panel } from "../../ds/Panel";
import type { KBApi } from "./api";
import { KB_FIELD_BASE } from "./kb-field-classes";

type Props = {
  api: KBApi;
};

type WikiPage = { path: string; title: string; type: string };

export function KnowledgeWikiPanel({ api }: Props) {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [purpose, setPurpose] = useState("");
  const [purposeDraft, setPurposeDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pageList, purposeText] = await Promise.all([api.listWikiPages(), api.getPurpose()]);
      setPages(pageList);
      setPurpose(purposeText);
      setPurposeDraft(purposeText);
      if (pageList.length > 0 && !selectedPath) {
        setSelectedPath(pageList[0].path);
      }
    } catch (exc) {
      setError(String((exc as Error).message ?? exc));
    } finally {
      setLoading(false);
    }
  }, [api, selectedPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedPath) {
      setPreview("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const content = await api.getWikiPage(selectedPath);
        if (!cancelled) setPreview(content);
      } catch (exc) {
        if (!cancelled) setPreview(String((exc as Error).message ?? exc));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, selectedPath]);

  async function savePurpose() {
    setSaveHint(null);
    try {
      await api.savePurpose(purposeDraft);
      setPurpose(purposeDraft);
      setSaveHint("已保存");
    } catch (exc) {
      setSaveHint(`保存失败：${String((exc as Error).message ?? exc)}`);
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="知识库意图 (purpose.md)" icon={<BookOpen className="h-4 w-4" />}>
        <textarea
          className={`min-h-[88px] w-full resize-y ${KB_FIELD_BASE}`}
          value={purposeDraft}
          onChange={(e) => setPurposeDraft(e.target.value)}
          placeholder="描述此知识脑的目标与边界，供 Wiki 编译时使用…"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)]"
            onClick={() => void savePurpose()}
            disabled={purposeDraft === purpose}
          >
            保存意图
          </button>
          {saveHint ? <span className="text-xs text-text-muted">{saveHint}</span> : null}
        </div>
      </Panel>

      <Panel title="Wiki 页面（只读）" icon={<BookOpen className="h-4 w-4" />}>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载 Wiki…
          </div>
        ) : error ? (
          <p className="text-xs text-rose-300">{error}</p>
        ) : pages.length === 0 ? (
          <p className="py-4 text-xs text-text-muted">
            尚无编译页。在配置中启用「Wiki 编译」并完成资料入库后会自动生成。
          </p>
        ) : (
          <div className="flex min-h-[240px] gap-3">
            <div className="w-44 shrink-0 overflow-y-auto rounded border border-border bg-surface-panel/40">
              {pages.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  className={`block w-full truncate px-2 py-1.5 text-left text-xs ${
                    selectedPath === p.path
                      ? "bg-[var(--settings-accent-solid)] text-[var(--settings-accent-solid-text)]"
                      : "text-text-muted hover:bg-surface-hover"
                  }`}
                  title={p.path}
                  onClick={() => setSelectedPath(p.path)}
                >
                  {p.title || p.path}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 overflow-auto rounded border border-border bg-surface-panel/30 p-2">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 读取页面…
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-text-primary">
                  {preview}
                </pre>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
