import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ImageContentBlock } from "../../utils/content-blocks";
import { readyLightboxImages } from "../../utils/content-blocks";
import { pathToFileUrl } from "../../utils/session-artifacts";
import { Shimmer } from "../ds/Shimmer";
import { Modal } from "../ds/Modal";
import { ZoomableImage } from "../ds/ZoomableImage";

type Props = {
  block: ImageContentBlock;
  gallery?: ImageContentBlock[];
};

function blockSrc(block: ImageContentBlock): string {
  const path = String(block.path ?? "").trim();
  if (path) return pathToFileUrl(path);
  return String(block.url ?? "").trim();
}

function elapsedLabel(startedAt?: number, now = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt)) return "0s";
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${sec}s`;
}

function isRemoteImageBlock(block: ImageContentBlock): boolean {
  return block.kind === "remote" || (!block.path && Boolean(String(block.url ?? "").trim()));
}

function openExternalUrl(url: string) {
  const desktop = window.agenticxDesktop as { openExternal?: (href: string) => unknown } | undefined;
  if (desktop?.openExternal) {
    void desktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function InlineImageLoadFailedNotice({ sourceUrl }: { sourceUrl?: string }) {
  return (
    <p className="my-1 text-[13px] leading-relaxed text-text-faint">
      图片无法加载
      {sourceUrl ? (
        <>
          {" "}
          <SourceLink href={sourceUrl} />
        </>
      ) : null}
    </p>
  );
}

function sourceHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "来源";
  } catch {
    return "来源";
  }
}

const lightboxNavBtnClass =
  "pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-black/15 bg-[var(--surface-popover)] text-text-strong shadow-[0_2px_10px_rgba(0,0,0,0.28)] hover:bg-[color-mix(in_srgb,var(--surface-popover)_82%,var(--text-strong)_18%)]";

function SourceLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-[rgb(var(--theme-color-rgb,59,130,246))] underline-offset-2 hover:underline hover:opacity-90"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openExternalUrl(href);
      }}
    >
      {children ?? "来源"}
    </a>
  );
}

export function InlineImageBlock({ block, gallery }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(block.id);
  const remote = isRemoteImageBlock(block);
  const lightboxItems = useMemo(() => {
    const items = readyLightboxImages(gallery);
    if (items.some((item) => item.id === block.id)) return items;
    if (block.status === "ready" && blockSrc(block)) return [block, ...items];
    return items;
  }, [block, gallery]);
  const active = lightboxItems.find((item) => item.id === activeId) ?? block;
  const activeIndex = Math.max(
    0,
    lightboxItems.findIndex((item) => item.id === active.id),
  );
  const canNavigate = lightboxItems.length > 1;

  useEffect(() => {
    if (block.status !== "generating") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [block.status, block.startedAt]);

  useEffect(() => {
    setLoaded(false);
    setLoadError(false);
  }, [block.path, block.url, block.id]);

  useEffect(() => {
    if (open) setActiveId(block.id);
  }, [open, block.id]);

  useEffect(() => {
    if (!open || !canNavigate) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveId((current) => {
          const idx = lightboxItems.findIndex((item) => item.id === current);
          const next = (idx - 1 + lightboxItems.length) % lightboxItems.length;
          return lightboxItems[next]?.id ?? current;
        });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveId((current) => {
          const idx = lightboxItems.findIndex((item) => item.id === current);
          const next = (idx + 1) % lightboxItems.length;
          return lightboxItems[next]?.id ?? current;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, canNavigate, lightboxItems]);

  if (block.status === "generating") {
    return (
      <div
        className={
          remote
            ? "my-2 w-[min(100%,280px)] overflow-hidden rounded-xl border border-border bg-surface-panel px-3 py-3"
            : "my-1 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface-panel px-3 py-3"
        }
      >
        <Shimmer
          variant="status"
          text={`${remote ? "加载图片中" : "生成图片中"}… ${elapsedLabel(block.startedAt, now)}`}
          className="text-[13px]"
        />
      </div>
    );
  }

  if (block.status === "error") {
    return (
      <p className="my-1 text-[13px] leading-relaxed text-text-faint">
        {block.error?.trim() || "图片生成失败"}
        {block.source_url ? (
          <>
            {" "}
            <SourceLink href={block.source_url} />
          </>
        ) : null}
      </p>
    );
  }

  if (block.status === "cancelled") {
    return <p className="my-1 text-[13px] leading-relaxed text-text-faint">已取消</p>;
  }

  const src = blockSrc(block);
  const activeSrc = blockSrc(active);
  if (!src) {
    return <p className="my-1 text-[13px] leading-relaxed text-text-faint">图片路径无效</p>;
  }

  if (loadError) {
    return <InlineImageLoadFailedNotice sourceUrl={block.source_url} />;
  }

  const caption = remote ? (
    block.alt || block.source_url ? (
      <p className="mb-1.5 max-w-[280px] text-[13px] leading-relaxed text-text-muted">
        {block.alt ? <span>{block.alt}</span> : null}
        {block.alt && block.source_url ? <span>，</span> : null}
        {block.source_url ? (
          <>
            来源：
            <SourceLink href={block.source_url}>{sourceHostLabel(block.source_url)}</SourceLink>
          </>
        ) : null}
      </p>
    ) : null
  ) : block.alt || block.source_url ? (
    <div className="mt-[-2px] mb-1 px-2 text-[11px] text-text-faint">
      {block.alt ? <span>{block.alt}</span> : null}
      {block.alt && block.source_url ? <span> · </span> : null}
      {block.source_url ? <SourceLink href={block.source_url} /> : null}
    </div>
  ) : null;

  return (
    <div className={remote ? "my-3" : undefined}>
      {remote ? caption : null}
      <button
        type="button"
        className={
          remote
            ? "group block max-w-[280px] overflow-hidden rounded-xl border border-border bg-surface-panel text-left"
            : "group my-1 block w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface-panel text-left"
        }
        title={block.alt || "点击查看原图"}
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={block.alt || "image"}
          className={
            remote
              ? "max-h-[240px] w-auto max-w-full object-contain transition-opacity duration-300"
              : "max-h-[70vh] w-full object-contain transition-opacity duration-300"
          }
          style={{ opacity: loaded ? 1 : 0 }}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setLoadError(true)}
        />
      </button>
      {remote ? null : caption}
      <Modal
        open={open}
        title={
          canNavigate
            ? `${active.alt || "图片预览"}  ${activeIndex + 1}/${lightboxItems.length}`
            : active.alt || "图片预览"
        }
        onClose={() => setOpen(false)}
        panelClassName="w-[90vw] max-w-4xl bg-surface-popover"
      >
        <div className="relative">
          <ZoomableImage
            key={active.id}
            src={activeSrc}
            alt={active.alt || "image"}
            maxHeight="70vh"
          />
          {canNavigate ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-8 z-10 flex items-center justify-between px-2">
              <button
                type="button"
                aria-label="上一张"
                className={lightboxNavBtnClass}
                onClick={(event) => {
                  event.stopPropagation();
                  const next = (activeIndex - 1 + lightboxItems.length) % lightboxItems.length;
                  setActiveId(lightboxItems[next]?.id ?? active.id);
                }}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                aria-label="下一张"
                className={lightboxNavBtnClass}
                onClick={(event) => {
                  event.stopPropagation();
                  const next = (activeIndex + 1) % lightboxItems.length;
                  setActiveId(lightboxItems[next]?.id ?? active.id);
                }}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
