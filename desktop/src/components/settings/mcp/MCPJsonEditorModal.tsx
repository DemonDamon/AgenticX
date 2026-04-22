import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import { Modal } from "../../ds/Modal";

const MonacoEditor = lazy(async () => {
  const mod = await import("@monaco-editor/react");
  return { default: mod.default };
});

const MCP_JSON_SCHEMA = {
  type: "object",
  properties: {
    mcpServers: {
      type: "object",
      additionalProperties: {
        type: "object",
        oneOf: [{ required: ["command"] }, { required: ["url"] }],
      },
    },
  },
  additionalProperties: true,
} as const;

type Props = {
  open: boolean;
  selectedPath: string;
  filePaths: string[];
  onClose: () => void;
  onPickPath: (path: string) => void;
  onLoad: (path: string) => Promise<{ ok: boolean; text?: string; format?: string; parse_error?: string; error?: string }>;
  onSave: (path: string, text: string) => Promise<{ ok: boolean; error?: string }>;
};

export function MCPJsonEditorModal({
  open,
  selectedPath,
  filePaths,
  onClose,
  onPickPath,
  onLoad,
  onSave,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [format, setFormat] = useState("json");
  const [message, setMessage] = useState("");
  const [saveToast, setSaveToast] = useState("");
  const saveToastTimerRef = useRef<number | null>(null);

  // 父组件常把 onLoad/onSave 写成内联匿名函数，每次 rerender 引用都会变化。
  // 这里用 ref 固化最新引用，effect 只依赖 open + selectedPath，避免定时刷新
  // 导致编辑器不断重新读文件、覆盖用户正在编辑的文本、并让光标闪烁。
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    if (!open || !selectedPath) return;
    let cancelled = false;
    setLoading(true);
    setMessage("");
    void onLoadRef.current(selectedPath)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setText(String(r.text || ""));
          setFormat(String(r.format || "json"));
          if (r.parse_error) setMessage(`解析提示：${r.parse_error}`);
        } else {
          setMessage(r.error || "读取失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedPath]);

  const canSave = useMemo(() => format === "json" && !loading && !saving, [format, loading, saving]);
  const showSaveToast = useCallback((msg: string) => {
    setSaveToast(msg);
    if (saveToastTimerRef.current !== null) {
      window.clearTimeout(saveToastTimerRef.current);
    }
    saveToastTimerRef.current = window.setTimeout(() => {
      setSaveToast("");
      saveToastTimerRef.current = null;
    }, 1800);
  }, []);

  useEffect(
    () => () => {
      if (saveToastTimerRef.current !== null) {
        window.clearTimeout(saveToastTimerRef.current);
      }
    },
    [],
  );

  const doSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await onSave(selectedPath, text);
      if (result.ok) {
        setMessage("保存成功");
        showSaveToast("已保存");
      } else {
        setMessage(result.error || "保存失败");
      }
    } finally {
      setSaving(false);
    }
  }, [canSave, onSave, selectedPath, showSaveToast, text]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        void doSave();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [doSave, open]);

  return (
    <>
      {saveToast
        ? createPortal(
            <div className="pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center">
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/40 bg-[#1a2a20]/90 px-6 py-3.5 shadow-2xl backdrop-blur-sm">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2.5} />
                <span className="text-sm font-medium text-emerald-300">{saveToast}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    <Modal
      open={open}
      title="编辑 MCP 配置"
      onClose={onClose}
      panelClassName="w-[min(1100px,96vw)] bg-surface-panel rounded-xl border border-border shadow-2xl"
      footer={(
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-text-faint">{message || (format === "json" ? "JSON 模式支持保存" : `${format} 仅预览`)}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover"
              onClick={onClose}
            >
              关闭
            </button>
            <button
              type="button"
              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] disabled:opacity-40"
              disabled={!canSave}
              onClick={() => {
                void doSave();
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-2">
        <div>
          <select
            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs"
            value={selectedPath}
            onChange={(e) => onPickPath(e.target.value)}
          >
            {filePaths.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="h-[min(70vh,720px)] overflow-hidden rounded-md border border-border">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-text-faint">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              读取中...
            </div>
          ) : format !== "json" ? (
            <textarea
              className="h-full w-full resize-none bg-surface-panel p-2 font-mono text-xs text-text-muted outline-none"
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly
            />
          ) : (
            <Suspense fallback={<div className="p-3 text-sm text-text-faint">加载编辑器中...</div>}>
              <MonacoEditor
                height="100%"
                language="json"
                value={text}
                onMount={(editor, monaco) => {
                  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                    validate: true,
                    schemas: [
                      {
                        uri: "https://agenticx.local/mcp-schema.json",
                        fileMatch: ["*"],
                        schema: MCP_JSON_SCHEMA,
                      },
                    ],
                  });
                  editor.updateOptions({ minimap: { enabled: false }, fontSize: 12 });
                }}
                onChange={(value) => setText(value || "")}
                theme="vs-dark"
                options={{
                  automaticLayout: true,
                  formatOnPaste: true,
                  formatOnType: true,
                }}
              />
            </Suspense>
          )}
        </div>
      </div>
    </Modal>
    </>
  );
}
