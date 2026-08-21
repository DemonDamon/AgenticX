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

export function InlineImageBlock({ block }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (block.status !== "generating") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [block.status, block.startedAt]);

  useEffect(() => {
    setLoaded(false);
  }, [block.path, block.id]);

  if (block.status === "generating") {
    return (
      <div className="my-1 w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface-panel px-3 py-3">
        <Shimmer
          variant="status"
          text={`生成图片中… ${elapsedLabel(block.startedAt, now)}`}
          className="text-[13px]"
        />
      </div>
    );
  }

  if (block.status === "error") {
    return (
      <p className="my-1 text-[13px] leading-relaxed text-text-faint">
        {block.error?.trim() || "图片生成失败"}
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
          onLoad={() => setLoaded(true)}
        />
        {block.alt ? (
          <div className="px-2 py-1 text-[11px] text-text-faint">{block.alt}</div>
        ) : null}
      </button>
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
