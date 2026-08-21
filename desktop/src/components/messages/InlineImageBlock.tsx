import { useEffect, useState } from "react";
import type { ImageContentBlock } from "../../utils/content-blocks";
import { pathToFileUrl } from "../../utils/session-artifacts";
import { Shimmer } from "../ds/Shimmer";
import { Modal } from "../ds/Modal";
import { ZoomableImage } from "../ds/ZoomableImage";

type Props = {
  block: ImageContentBlock;
};

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

function SourceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="text-[rgb(var(--theme-color-rgb,59,130,246))] underline underline-offset-2 hover:opacity-90"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openExternalUrl(href);
      }}
    >
      来源
    </a>
  );
}

export function InlineImageBlock({ block }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const remote = isRemoteImageBlock(block);

  useEffect(() => {
    if (block.status !== "generating") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [block.status, block.startedAt]);

  useEffect(() => {
    setLoaded(false);
    setLoadError(false);
  }, [block.path, block.url, block.id]);

  if (block.status === "generating") {
    return (
      <div className="my-1 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface-panel px-3 py-3">
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

  const src = block.path ? pathToFileUrl(block.path) : String(block.url ?? "").trim();
  if (!src) {
    return <p className="my-1 text-[13px] leading-relaxed text-text-faint">图片路径无效</p>;
  }

  if (loadError) {
    return <InlineImageLoadFailedNotice sourceUrl={block.source_url} />;
  }

  return (
    <>
      <button
        type="button"
        className="group my-1 block w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface-panel text-left"
        title={block.alt || "点击查看原图"}
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={block.alt || "image"}
          className="max-h-[70vh] w-full object-contain transition-opacity duration-300"
          style={{ opacity: loaded ? 1 : 0 }}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setLoadError(true)}
        />
      </button>
      {block.alt || block.source_url ? (
        <div className="mt-[-2px] mb-1 px-2 text-[11px] text-text-faint">
          {block.alt ? <span>{block.alt}</span> : null}
          {block.alt && block.source_url ? <span> · </span> : null}
          {block.source_url ? <SourceLink href={block.source_url} /> : null}
        </div>
      ) : null}
      <Modal
        open={open}
        title={block.alt || "图片预览"}
        onClose={() => setOpen(false)}
        panelClassName="w-[90vw] max-w-4xl bg-surface-popover"
      >
        <ZoomableImage src={src} alt={block.alt || "image"} maxHeight="70vh" />
      </Modal>
    </>
  );
}
