import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PreviewFallback } from "./PreviewFallback";
import { i18n } from "../../i18n/i18n";

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
  const { t } = useTranslation("workspace");
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
      setError(i18n.t("preview.videoUnsupported", { ns: "workspace" }));
      return () => {
        cancelled = true;
      };
    }
    void api(absolutePath)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.url) {
          setError(res.error ?? i18n.t("preview.videoOpenFailed", { ns: "workspace" }));
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
        title={t("preview.kindVideo")}
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
          <div className="text-sm text-text-muted">{t("preview.videoOpening")}</div>
        ) : (
          <video
            key={src}
            className="max-h-full max-w-full rounded border border-[var(--border-subtle)] bg-black"
            controls
            preload="metadata"
            src={src}
            onError={() =>
              setError(i18n.t("preview.videoPlayFailed", { ns: "workspace" }))
            }
          />
        )}
      </div>
    </div>
  );
}
