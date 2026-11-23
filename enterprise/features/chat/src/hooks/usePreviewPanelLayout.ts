"use client";

import * as React from "react";
import { DOCKED_PREVIEW_MIN_WIDTH } from "../utils/usable-viewport";

/** Container measurements also catch sidebar and segmented-frame changes. */
export function usePreviewPanelLayout(open: boolean) {
  const panelRef = React.useRef<HTMLElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null);
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const parent = panel.parentElement;
    const measure = () => setContainerWidth(parent?.clientWidth || window.innerWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (parent) observer?.observe(parent);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);
  return { panelRef, containerWidth, overlay: containerWidth !== null && containerWidth < DOCKED_PREVIEW_MIN_WIDTH };
}

/** Restore prior focus without scrolling the underlying chat. */
export function usePreviewDialog(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
) {
  const escapeRef = React.useRef(onEscape);
  escapeRef.current = onEscape;
  React.useEffect(() => {
    const panel = ref.current;
    if (!active || !panel) return;
    const document = panel.ownerDocument;
    const previous = document.activeElement;
    const isTopDialog = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[data-preview-modal=true]"));
      return dialogs.reduce<HTMLElement | null>((top, node) => {
        const z = Number.parseInt(getComputedStyle(node).zIndex, 10) || 0;
        const previousZ = top ? Number.parseInt(getComputedStyle(top).zIndex, 10) || 0 : -Infinity;
        return z >= previousZ ? node : top;
      }, null) === panel;
    };
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), iframe, [contenteditable=true], [tabindex='0']",
    )).filter((node) => node.tabIndex >= 0 && !node.closest("[hidden], [inert], [aria-hidden=true]")
      && getComputedStyle(node).display !== "none" && getComputedStyle(node).visibility !== "hidden");
    const focusFirst = () => (panel.querySelector<HTMLElement>("[data-preview-close]") ?? focusable()[0])?.focus({ preventScroll: true });
    if (isTopDialog() && !panel.contains(previous)) {
      focusFirst();
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (!isTopDialog()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        escapeRef.current();
      } else if (event.key === "Tab") {
        const nodes = focusable();
        const current = nodes.indexOf(document.activeElement as HTMLElement);
        const next = current < 0 ? (event.shiftKey ? nodes.length - 1 : 0)
          : (current + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
        // Some engines' system keyboard policy skips buttons during native Tab
        // navigation. Move through the dialog's controls explicitly so it cannot
        // escape between the first and last controls either.
        event.preventDefault();
        nodes[next]?.focus({ preventScroll: true });
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (panel.isConnected && isTopDialog() && !panel.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", containFocus);
      const active = document.activeElement;
      if ((panel.contains(active) || (!panel.isConnected && active === document.body))
        && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [active, ref]);
}
