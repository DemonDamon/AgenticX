import { useEffect, useState } from "react";
import { PreviewFallback } from "./PreviewFallback";

type VideoPreviewProps = {
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

export function VideoPreview({
  absolutePath,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: VideoPreviewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSrc(null);
    const api = window.agenticxDesktop?.resolveLocalMediaUrl;
    if (typeof api !== "function") {
      setLoading(false);
      setError("当前客户端不支持视频预览，请完全退出后重新打开应用。");
      return () => {
        cancelled = true;
      };
    }
    void api(absolutePath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.url) {
          setError(res.error ?? "无法打开该视频");
          return;
        }
        setSrc(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  if (error) {
    return (
      <PreviewFallback
        title="视频"
        message={error}
        mimeType={mimeType}
        onCopyPath={onCopyPath}
        onRevealInFileManager={onRevealInFileManager}
        revealInFileManagerLabel={revealInFileManagerLabel}
        absolutePath={absolutePath}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        {loading || !src ? (
          <div className="text-sm text-text-muted">正在打开视频…</div>
        ) : (
          <video
            key={src}
            className="max-h-full max-w-full rounded border border-[var(--border-subtle)] bg-black"
            controls
            preload="metadata"
            src={src}
            onError={() =>
              setError("无法播放该视频。编码可能不受支持，可在系统应用中打开。")
            }
          />
        )}
      </div>
    </div>
  );
}
