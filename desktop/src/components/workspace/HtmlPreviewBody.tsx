import { useEffect, useState } from "react";
import { prepareLocalHtmlSrcDoc } from "../../utils/html-preview-assets";

type HtmlPreviewBodyProps = {
  content: string;
  title?: string;
  /** Absolute path of the HTML file — used to inline relative local assets for srcDoc. */
  documentPath?: string;
};

/**
 * Render HTML via a sandboxed iframe (srcDoc).
 * Scripts may run inside the frame, but cannot touch the parent document
 * (no allow-same-origin). When `documentPath` is set, relative local assets
 * (e.g. sibling `.svg`) are rewritten to data URLs before render.
 */
export function HtmlPreviewBody({ content, title, documentPath }: HtmlPreviewBodyProps) {
  const [srcDoc, setSrcDoc] = useState(content);

  useEffect(() => {
    let cancelled = false;
    const path = String(documentPath || "").trim();
    if (!path) {
      setSrcDoc(content);
      return;
    }
    void prepareLocalHtmlSrcDoc(path, content).then((next) => {
      if (!cancelled) setSrcDoc(next);
    });
    return () => {
      cancelled = true;
    };
  }, [content, documentPath]);

  return (
    <iframe
      title={title ?? "HTML 预览"}
      className="block h-full min-h-[220px] w-full border-0 bg-white"
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
    />
  );
}

export function isHtmlPreviewPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}
