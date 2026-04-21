import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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

  useEffect(() => {
    if (!open || !selectedPath) return;
    setLoading(true);
    setMessage("");
    void onLoad(selectedPath)
      .then((r) => {
        if (r.ok) {
          setText(String(r.text || ""));
          setFormat(String(r.format || "json"));
          if (r.parse_error) setMessage(`解析提示：${r.parse_error}`);
        } else {
          setMessage(r.error || "读取失败");
        }
      })
      .finally(() => setLoading(false));
  }, [open, selectedPath, onLoad]);

  const canSave = useMemo(() => format === "json" && !loading && !saving, [format, loading, saving]);

  return (
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
                if (!canSave) return;
                setSaving(true);
                setMessage("");
                void onSave(selectedPath, text)
                  .then((r) => setMessage(r.ok ? "保存成功" : (r.error || "保存失败")))
                  .finally(() => setSaving(false));
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
  );
}
