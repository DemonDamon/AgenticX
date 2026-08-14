import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, X } from "lucide-react";
import { marked } from "marked";
import { toPng } from "html-to-image";
import type { Message } from "../store";
import {
  SHARE_WIDGET_HINT,
  buildShareImageTurns,
  formatShareCardDate,
} from "../utils/share-image-model";
import { APP_DISPLAY_NAME, APP_TAGLINE } from "../constants/branding";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";

export type ShareImagePreviewModalProps = {
  open: boolean;
  messages: Message[];
  sessionTitle?: string;
  userBubbleLabel?: string;
  onClose: () => void;
  onToast: (message: string) => void;
};

function assistantMarkdownHtml(text: string): string {
  if (!text.trim()) return "";
  const html = marked.parse(text, { async: false }) as string;
  return html.replace(/<pre>/g, '<pre class="agx-chat-prism">');
}

function fileStamp(now: number): string {
  return new Date(now)
    .toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    .replace(":", "-");
}

/** Opaque page surface — `bg-surface-card` is a translucent overlay and composites to white in PNG. */
function opaqueShareSurface(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--surface-base-fallback")
    .trim();
  return raw || "#1C1C1E";
}

async function waitForImages(el: HTMLElement): Promise<void> {
  const imgs = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
}

async function cardToPngBuffer(el: HTMLElement): Promise<ArrayBuffer> {
  await waitForImages(el);
  const bg = opaqueShareSurface();
  const color =
    getComputedStyle(document.documentElement).getPropertyValue("--text-strong").trim() ||
    "#ffffff";
  const dataUrl = await toPng(el, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: bg,
    style: {
      backgroundColor: bg,
      color,
    },
  });
  return await (await fetch(dataUrl)).arrayBuffer();
}

export function ShareImagePreviewModal({
  open,
  messages,
  sessionTitle,
  onClose,
  onToast,
}: ShareImagePreviewModalProps) {
  const shareCardRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [error, setError] = useState("");
  const [exportedAt, setExportedAt] = useState(() => Date.now());
  const turns = useMemo(() => buildShareImageTurns(messages), [messages]);
  const dateLabel = formatShareCardDate(exportedAt);

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setError("");
      return;
    }
    setExportedAt(Date.now());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const runCapture = useCallback(
    async (mode: "copy" | "download") => {
      const el = shareCardRef.current;
      if (!el) {
        setError("栅格化失败：卡片未就绪");
        return;
      }
      setBusy(mode);
      setError("");
      try {
        const buf = await cardToPngBuffer(el);
        const desktop = window.agenticxDesktop;
        if (mode === "copy") {
          if (!desktop?.copyPngToClipboard) {
            throw new Error("当前环境不支持复制图片");
          }
          const res = await desktop.copyPngToClipboard(buf);
          if (!res.ok) throw new Error(res.error || "复制失败");
          onToast("已复制图片");
        } else {
          if (!desktop?.downloadPngToDownloads) {
            throw new Error("当前环境不支持下载图片");
          }
          const slug = (sessionTitle || "对话").replace(/[\\/:*?"<>|]/g, "_").slice(0, 32);
          const res = await desktop.downloadPngToDownloads({
            buffer: buf,
            defaultFileName: `${APP_DISPLAY_NAME}对话_${slug}_${fileStamp(Date.now())}.png`,
          });
          if (!res.ok) throw new Error(res.error || "下载失败");
          onToast(res.path ? `已保存到 ${res.path}` : "已保存图片");
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        setError(raw.startsWith("栅格化失败") ? raw : `栅格化失败：${raw.slice(0, 120)}`);
      } finally {
        setBusy(null);
      }
    },
    [onToast, sessionTitle],
  );

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div
        className="flex max-h-[min(92vh,920px)] w-[min(100%,780px)] flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ backgroundColor: "var(--surface-popover)" }}
      >
        <div className="flex items-center justify-between px-5 py-3">
          <h3 className="text-sm font-semibold text-text-strong">分享图片预览</h3>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
            aria-label="关闭"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2" style={{ maxHeight: "min(70vh, 720px)" }}>
          <div className="flex justify-center py-2">
            <div
              ref={shareCardRef}
              className="w-full rounded-2xl px-8 py-7 text-text-strong"
              style={{ backgroundColor: "var(--surface-base-fallback)" }}
            >
              <div className="text-[20px] font-semibold">分享对话</div>
              <div className="mt-1.5 text-[13px] text-text-muted">{dateLabel}</div>
              <div className="mt-0.5 text-[13px] text-text-muted">内容由 AI 生成，不能完全保障真实</div>
              <div className="mt-5 border-t border-border pt-5">
                <div className="flex flex-col gap-4">
                  {turns.map((turn, idx) =>
                    turn.kind === "user" ? (
                      <div key={`u-${idx}`} className="flex justify-end">
                        <div
                          className="max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed"
                          style={{
                            backgroundColor:
                              "color-mix(in srgb, var(--text-strong) 12%, var(--surface-base-fallback) 88%)",
                          }}
                        >
                          {turn.text}
                        </div>
                      </div>
                    ) : (
                      <div key={`a-${idx}`} className="msg-content w-full text-left text-[14px] leading-relaxed">
                        {turn.text ? (
                          <div
                            className="share-md [&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2.5 [&_ol]:my-2.5 [&_h1]:text-[17px] [&_h2]:text-[16px] [&_h3]:text-[15px] [&_table]:w-full [&_table]:border-collapse [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_td]:px-2.5 [&_td]:py-1.5"
                            dangerouslySetInnerHTML={{ __html: assistantMarkdownHtml(turn.text) }}
                          />
                        ) : null}
                        {turn.hasWidgetHint ? (
                          <div className="mt-1 text-[13px] text-text-muted">{SHARE_WIDGET_HINT}</div>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              </div>
              <div className="mt-8 flex items-center gap-3 border-t border-border pt-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-white">
                  <img
                    src={DEFAULT_META_AVATAR_URL}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[16px] font-semibold leading-tight">{APP_DISPLAY_NAME}</div>
                  <div className="mt-0.5 text-[12px] text-text-muted">{APP_TAGLINE}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {error ? (
          <div className="px-5 pb-2 text-center text-[12px] text-rose-300">{error}</div>
        ) : null}
        <div className="flex items-center justify-center gap-3 px-5 py-4">
          <button
            type="button"
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] text-text-strong transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: "var(--surface-base-fallback)" }}
            onClick={() => void runCapture("copy")}
          >
            <Copy className="h-3.5 w-3.5" />
            {busy === "copy" ? "复制中…" : "复制图片"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: "var(--ui-btn-primary-bg)",
              color: "var(--ui-btn-primary-text)",
            }}
            onClick={() => void runCapture("download")}
          >
            <Download className="h-3.5 w-3.5" />
            {busy === "download" ? "保存中…" : "下载图片"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
