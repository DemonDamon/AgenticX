type HtmlPreviewBodyProps = {
  content: string;
  title?: string;
};

/**
 * Render HTML via a sandboxed iframe (srcDoc).
 * Scripts may run inside the frame, but cannot touch the parent document
 * (no allow-same-origin). Relative asset URLs will not resolve to the
 * file's directory — self-contained HTML (inline CSS/JS) works best.
 */
export function HtmlPreviewBody({ content, title }: HtmlPreviewBodyProps) {
  return (
    <iframe
      title={title ?? "HTML 预览"}
      className="block h-full min-h-[220px] w-full border-0 bg-white"
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
      srcDoc={content}
      referrerPolicy="no-referrer"
    />
  );
}

export function isHtmlPreviewPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}
