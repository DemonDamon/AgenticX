import { useCallback, useState } from "react";
import { pathToFileUrl } from "../../utils/session-artifacts";
import { previewBaseName, type WorkspaceHtmlElementQuote } from "./workspace-preview-types";
import { HtmlElementSelectPopover } from "./HtmlElementSelectPopover";
import { HtmlPreviewBody, type HtmlPreviewElementHit } from "./HtmlPreviewBody";
import { HtmlPreviewChrome } from "./HtmlPreviewChrome";
import {
  DEFAULT_HTML_PREVIEW_VIEWPORT,
  type HtmlPreviewViewport,
} from "./html-preview-device";

type HtmlPreviewShellProps = {
  content: string;
  title?: string;
  documentPath?: string | null;
  /** Override URL for address/share; defaults to file:// from documentPath. */
  documentUrl?: string | null;
  onViewSource?: () => void;
  /** Trae-style：添加到对话 / 评论到对话. */
  onQuoteHtmlElement?: (payload: WorkspaceHtmlElementQuote) => void;
  className?: string;
};

export function HtmlPreviewShell({
  content,
  title,
  documentPath,
  documentUrl,
  onViewSource,
  onQuoteHtmlElement,
  className,
}: HtmlPreviewShellProps) {
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [deviceToolbarVisible, setDeviceToolbarVisible] = useState(false);
  const [viewport, setViewport] = useState<HtmlPreviewViewport>(DEFAULT_HTML_PREVIEW_VIEWPORT);
  const [elementHit, setElementHit] = useState<HtmlPreviewElementHit | null>(null);
  const [clearSelectionKey, setClearSelectionKey] = useState(0);

  const absPath = String(documentPath || "").trim();
  const url =
    String(documentUrl || "").trim() || (absPath ? pathToFileUrl(absPath) : "");

  const openInBrowser = useCallback(() => {
    if (absPath) {
      void window.agenticxDesktop?.shellOpenPath?.(absPath);
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      void window.agenticxDesktop?.openExternal?.(url);
    }
  }, [absPath, url]);

  const quoteElement = useCallback(
    (intent: "add" | "comment", comment?: string) => {
      if (!elementHit || !absPath || !onQuoteHtmlElement) return;
      const tag = elementHit.tagName || "element";
      // Trae chip: tag on the left; comment (if any) after middle-dot.
      const commentText = String(comment || "").trim();
      const label = commentText ? `${tag} · ${commentText}` : tag;
      onQuoteHtmlElement({
        kind: "html-element",
        path: previewBaseName(absPath),
        absolutePath: absPath,
        tagName: tag,
        selectorHint: elementHit.selectorHint || tag,
        outerHTML: elementHit.outerHTML,
        innerText: elementHit.innerText,
        label,
        intent,
        ...(commentText ? { comment: commentText } : {}),
      });
      setElementHit(null);
      setClearSelectionKey((k) => k + 1);
    },
    [absPath, elementHit, onQuoteHtmlElement]
  );

  return (
    <div className={["flex h-full min-h-0 flex-col", className ?? ""].join(" ")}>
      <HtmlPreviewChrome
        documentPath={absPath || null}
        documentUrl={url || null}
        inspectEnabled={inspectEnabled}
        onInspectEnabledChange={(enabled) => {
          setInspectEnabled(enabled);
          if (!enabled) {
            setElementHit(null);
            setClearSelectionKey((k) => k + 1);
          }
        }}
        inspectAvailable={Boolean(content)}
        deviceToolbarVisible={deviceToolbarVisible}
        onDeviceToolbarVisibleChange={setDeviceToolbarVisible}
        viewport={viewport}
        onViewportChange={setViewport}
        onOpenInBrowser={openInBrowser}
        onViewSource={onViewSource}
      />
      <div className="min-h-0 flex-1">
        <HtmlPreviewBody
          content={content}
          title={title}
          documentPath={absPath || undefined}
          inspectEnabled={inspectEnabled}
          onInspectEnabledChange={setInspectEnabled}
          viewport={viewport}
          onElementHitChange={setElementHit}
          clearSelectionKey={clearSelectionKey}
        />
      </div>
      {elementHit && onQuoteHtmlElement && absPath ? (
        <HtmlElementSelectPopover
          key={`${elementHit.tagName}-${elementHit.rect.top}-${elementHit.rect.left}`}
          anchor={elementHit.anchor}
          tagName={elementHit.tagName}
          onAddToChat={() => quoteElement("add")}
          onCommentToChat={(c) => quoteElement("comment", c)}
        />
      ) : null}
    </div>
  );
}
