import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Code2,
  Compass,
  Copy,
  Ellipsis,
  FolderOpen,
  Link2,
  MousePointer2,
  RotateCw,
  Share2,
  Smartphone,
} from "lucide-react";
import { HoverTip } from "../ds/HoverTip";
import { pathToFileUrl } from "../../utils/session-artifacts";
import {
  applyDevicePreset,
  DEFAULT_HTML_PREVIEW_VIEWPORT,
  HTML_DEVICE_PRESETS,
  HTML_ZOOM_OPTIONS,
  type HtmlDevicePresetId,
  type HtmlPreviewViewport,
  rotateViewport,
} from "./html-preview-device";

type HtmlPreviewChromeProps = {
  /** Absolute local path when previewing a file; null for remote-only tabs. */
  documentPath?: string | null;
  /** file:// or https URL shown / used for share + open. */
  documentUrl?: string | null;
  inspectEnabled: boolean;
  onInspectEnabledChange: (enabled: boolean) => void;
  /** Inspect only works for local srcDoc previews. */
  inspectAvailable?: boolean;
  deviceToolbarVisible: boolean;
  onDeviceToolbarVisibleChange: (visible: boolean) => void;
  viewport: HtmlPreviewViewport;
  onViewportChange: (next: HtmlPreviewViewport) => void;
  onOpenInBrowser: () => void;
  /** Optional: jump to source view (WorkspaceFilePreview). */
  onViewSource?: () => void;
  className?: string;
};

function IconBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverTip label={label}>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={[
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          disabled
            ? "cursor-not-allowed text-text-faint opacity-40"
            : active
              ? "bg-surface-card-strong text-text-strong"
              : "text-text-muted hover:bg-surface-hover hover:text-text-strong",
        ].join(" ")}
      >
        {children}
      </button>
    </HoverTip>
  );
}

export function HtmlPreviewChrome({
  documentPath,
  documentUrl,
  inspectEnabled,
  onInspectEnabledChange,
  inspectAvailable = true,
  deviceToolbarVisible,
  onDeviceToolbarVisibleChange,
  viewport,
  onViewportChange,
  onOpenInBrowser,
  onViewSource,
  className,
}: HtmlPreviewChromeProps) {
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState<"path" | "url" | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen && !moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shareOpen && shareRef.current && !shareRef.current.contains(t)) setShareOpen(false);
      if (moreOpen && moreRef.current && !moreRef.current.contains(t)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [shareOpen, moreOpen]);

  const copyText = async (text: string, kind: "path" | "url") => {
    const value = String(text || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const absPath = String(documentPath || "").trim();
  const url = String(documentUrl || "").trim() || (absPath ? pathToFileUrl(absPath) : "");

  return (
    <div className={["flex shrink-0 flex-col border-b border-border", className ?? ""].join(" ")}>
      <div className="flex items-center justify-end gap-0.5 px-2 py-1">
        <IconBtn
          label={inspectEnabled ? "退出选择元素" : "选择元素"}
          active={inspectEnabled}
          disabled={!inspectAvailable}
          onClick={() => onInspectEnabledChange(!inspectEnabled)}
        >
          <MousePointer2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </IconBtn>
        <IconBtn
          label="在浏览器中打开"
          onClick={onOpenInBrowser}
          disabled={!absPath && !/^https?:\/\//i.test(url)}
        >
          <Compass className="h-3.5 w-3.5" strokeWidth={1.8} />
        </IconBtn>
        <IconBtn
          label={deviceToolbarVisible ? "隐藏设备工具栏" : "显示设备工具栏"}
          active={deviceToolbarVisible}
          onClick={() => onDeviceToolbarVisibleChange(!deviceToolbarVisible)}
        >
          <Smartphone className="h-3.5 w-3.5" strokeWidth={1.8} />
        </IconBtn>

        <div className="relative" ref={shareRef}>
          <IconBtn
            label="分享"
            active={shareOpen}
            onClick={() => {
              setMoreOpen(false);
              setShareOpen((v) => !v);
            }}
          >
            <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </IconBtn>
          {shareOpen ? (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-md border border-border bg-surface-card py-1 shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
                disabled={!absPath}
                onClick={() => void copyText(absPath, "path")}
              >
                {copied === "path" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                复制文件路径
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
                disabled={!url}
                onClick={() => void copyText(url, "url")}
              >
                {copied === "url" ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                复制链接
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
                disabled={!absPath}
                onClick={() => {
                  void window.agenticxDesktop?.shellShowItemInFolder?.(absPath);
                  setShareOpen(false);
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                在文件管理器中显示
              </button>
            </div>
          ) : null}
        </div>

        <div className="relative" ref={moreRef}>
          <IconBtn
            label="更多"
            active={moreOpen}
            onClick={() => {
              setShareOpen(false);
              setMoreOpen((v) => !v);
            }}
          >
            <Ellipsis className="h-3.5 w-3.5" strokeWidth={1.8} />
          </IconBtn>
          {moreOpen ? (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border bg-surface-card py-1 shadow-lg">
              {onViewSource ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
                  onClick={() => {
                    onViewSource();
                    setMoreOpen(false);
                  }}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  查看源码
                </button>
              ) : null}
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
                onClick={() => {
                  onViewportChange(DEFAULT_HTML_PREVIEW_VIEWPORT);
                  onDeviceToolbarVisibleChange(false);
                  onInspectEnabledChange(false);
                  setMoreOpen(false);
                }}
              >
                重置预览视图
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {deviceToolbarVisible ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-surface-hover/40 px-2 py-1.5 text-[11px] text-text-muted">
          <span className="shrink-0 text-text-faint">Size</span>
          <select
            value={viewport.presetId}
            aria-label="预览尺寸预设"
            className="h-7 max-w-[140px] rounded-md border border-border bg-surface-card px-1.5 text-[11px] text-text-strong outline-none"
            onChange={(e) => {
              onViewportChange(applyDevicePreset(e.target.value as HtmlDevicePresetId));
            }}
          >
            {HTML_DEVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={200}
            max={4000}
            aria-label="预览宽度"
            value={viewport.width ?? ""}
            placeholder="宽"
            className="h-7 w-16 rounded-md border border-border bg-surface-card px-1.5 text-[11px] text-text-strong outline-none"
            onChange={(e) => {
              const n = Number(e.target.value);
              onViewportChange({
                ...viewport,
                presetId: "responsive",
                width: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
              });
            }}
          />
          <span className="text-text-faint">×</span>
          <input
            type="number"
            min={200}
            max={4000}
            aria-label="预览高度"
            value={viewport.height ?? ""}
            placeholder="高"
            className="h-7 w-16 rounded-md border border-border bg-surface-card px-1.5 text-[11px] text-text-strong outline-none"
            onChange={(e) => {
              const n = Number(e.target.value);
              onViewportChange({
                ...viewport,
                presetId: "responsive",
                height: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
              });
            }}
          />
          <select
            value={viewport.zoomPercent}
            aria-label="预览缩放"
            className="h-7 rounded-md border border-border bg-surface-card px-1.5 text-[11px] text-text-strong outline-none"
            onChange={(e) => {
              onViewportChange({ ...viewport, zoomPercent: Number(e.target.value) || 100 });
            }}
          >
            {HTML_ZOOM_OPTIONS.map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
          <IconBtn
            label="旋转方向"
            onClick={() => onViewportChange(rotateViewport(viewport))}
            disabled={viewport.width == null || viewport.height == null}
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />
          </IconBtn>
        </div>
      ) : null}
    </div>
  );
}
