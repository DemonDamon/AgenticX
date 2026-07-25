/**
 * Canonical path helpers for session-workspace sandbox checks.
 *
 * Author: Damon Li
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Canonicalize a path, tolerating a non-existent leaf.
 * Walks upward to the nearest existing ancestor, realpaths that ancestor,
 * then rejoins the remaining segments.
 */
export async function safeRealpath(p: string): Promise<string> {
  const absolute = path.resolve(String(p || ""));
  if (!absolute) return absolute;

  let cursor = absolute;
  const missing: string[] = [];
  // Walk up until we find an existing path (or hit filesystem root).
  while (true) {
    try {
      const real = await fs.promises.realpath(cursor);
      if (missing.length === 0) return real;
      return path.resolve(real, ...missing);
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        // Root does not exist / unreadable — fall back to resolved absolute.
        return missing.length === 0 ? absolute : path.resolve(absolute);
      }
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * True when `child` is `root` or lives under it, after both are canonicalized.
 * Uses `child === root || child.startsWith(root + sep)` — never bare startsWith
 * (otherwise `/a/bc` would match under `/a/b`).
 */
export async function isRealpathUnder(child: string, root: string): Promise<boolean> {
  const childReal = await safeRealpath(child);
  const rootReal = await safeRealpath(root);
  if (childReal === rootReal) return true;
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return childReal.startsWith(prefix);
}
