import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PreviewFallback } from "./PreviewFallback";
import { dataUrlToArrayBuffer, loadLocalPreviewDataUrl, stripScriptTags } from "./preview-data";

type DocxPreviewProps = {
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

export function DocxPreview({
  absolutePath,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: DocxPreviewProps) {
  const { t } = useTranslation("workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml("");

    void (async () => {
      const loaded = await loadLocalPreviewDataUrl(absolutePath);
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.error);
        setLoading(false);
        return;
      }
      try {
        const mammoth = await import("mammoth");
        const buffer = await dataUrlToArrayBuffer(loaded.dataUrl);
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (cancelled) return;
        setHtml(stripScriptTags(result.value));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center bg-surface-base p-6 text-sm text-text-muted">
        {t("preview.docxLoading")}
      </div>
    );
  }

  if (error || !html) {
    return (
      <PreviewFallback
        title={t("preview.officeTitle")}
        message={error ?? t("preview.docxFallback")}
        mimeType={mimeType}
        onCopyPath={onCopyPath}
        onRevealInFileManager={onRevealInFileManager}
        revealInFileManagerLabel={revealInFileManagerLabel}
        absolutePath={absolutePath}
      />
    );
  }

  return (
    <div
      className="agx-docx-preview msg-content px-6 py-5 text-[13px] leading-relaxed text-text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
