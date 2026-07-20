import { useCallback, useEffect, useState } from "react";
import { loadPreparedHtmlSrcDoc } from "../../utils/html-preview-assets";
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
  /** External reload nonce; merges with internal refresh remounts. */
  reloadKey?: number;
  /**
   * Show refresh on the tools chrome (WorkspaceFilePreview).
   * WorkPanel browser keeps refresh only in the address bar — set false.
   */
  showChromeRefresh?: boolean;
  className?: string;
};

export function HtmlPreviewShell({
  content,
  title,
  documentPath,
  documentUrl,
  onViewSource,
  onQuoteHtmlElement,
  reloadKey = 0,
  showChromeRefresh = true,
  className,
}: HtmlPreviewShellProps) {
  const [inspectEnabled, setInspectEnabled] = useState(false);
  const [deviceToolbarVisible, setDeviceToolbarVisible] = useState(false);
  const [viewport, setViewport] = useState<HtmlPreviewViewport>(DEFAULT_HTML_PREVIEW_VIEWPORT);
  const [elementHit, setElementHit] = useState<HtmlPreviewElementHit | null>(null);
  const [clearSelectionKey, setClearSelectionKey] = useState(0);
  const [localContent, setLocalContent] = useState<string | null>(null);
  const [internalReloadKey, setInternalReloadKey] = useState(0);

  const absPath = String(documentPath || "").trim();
  const url =
    String(documentUrl || "").trim() || (absPath ? pathToFileUrl(absPath) : "");
  const effectiveContent = localContent ?? content;
  const effectiveReloadKey = reloadKey + internalReloadKey;

  useEffect(() => {
    setLocalContent(null);
  }, [content, absPath]);

  const openInBrowser = useCallback(() => {
    if (absPath) {
      void window.agenticxDesktop?.shellOpenPath?.(absPath);
      return;
    }
    if (/^https?:\/\//i.test(url)) {
      void window.agenticxDesktop?.openExternal?.(url);
    }
  }, [absPath, url]);

  const refresh = useCallback(() => {
    void (async () => {
      if (absPath) {
        const prepared = await loadPreparedHtmlSrcDoc(absPath);
        if (prepared.ok) setLocalContent(prepared.srcDoc);
      }
      setInternalReloadKey((k) => k + 1);
      setElementHit(null);
      setClearSelectionKey((k) => k + 1);
    })();
  }, [absPath]);

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
        inspectAvailable={Boolean(effectiveContent)}
        deviceToolbarVisible={deviceToolbarVisible}
        onDeviceToolbarVisibleChange={setDeviceToolbarVisible}
        viewport={viewport}
        onViewportChange={setViewport}
        onOpenInBrowser={openInBrowser}
        onRefresh={showChromeRefresh ? refresh : undefined}
        onViewSource={onViewSource}
      />
      <div className="min-h-0 flex-1">
        <HtmlPreviewBody
          content={effectiveContent}
          title={title}
          documentPath={absPath || undefined}
          inspectEnabled={inspectEnabled}
          onInspectEnabledChange={setInspectEnabled}
          viewport={viewport}
          onElementHitChange={setElementHit}
          clearSelectionKey={clearSelectionKey}
          reloadKey={effectiveReloadKey}
        />
      </div>
      {elementHit && onQuoteHtmlElement && absPath ? (
        <HtmlElementSelectPopover
          // Stable across scroll rect-updates so comment draft is not remounted.
          key={`${elementHit.tagName}:${elementHit.selectorHint}:${elementHit.outerHTML.length}`}
          anchor={elementHit.anchor}
          tagName={elementHit.tagName}
          onAddToChat={() => quoteElement("add")}
          onCommentToChat={(c) => quoteElement("comment", c)}
        />
      ) : null}
    </div>
  );
}
