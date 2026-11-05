import { Fragment, isValidElement, type ReactNode } from "react";

/**
 * True when `node` would paint something in the tree.
 * Empty fragments (`<></>` / `<>{null}</>`) are falsy so callers can avoid
 * layout branches that only make sense with real chrome (e.g. artifact rows).
 */
export function hasVisibleReactNode(node: ReactNode): boolean {
  if (node == null || node === false || node === true) return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (typeof node === "number") return true;
  if (Array.isArray(node)) return node.some(hasVisibleReactNode);
  if (isValidElement(node)) {
    const isFragment =
      node.type === Fragment || node.type === Symbol.for("react.fragment");
    if (isFragment) {
      return hasVisibleReactNode(
        (node.props as { children?: ReactNode } | null)?.children,
      );
    }
    // Host/component elements count as visible chrome even with null children
    // (e.g. <img />, custom cards that render from props).
    return true;
  }
  return false;
}
