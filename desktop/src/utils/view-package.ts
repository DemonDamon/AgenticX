/**
 * Portable canvas view package (`agx-view-package/1`).
 *
 * The manifest is the contract both the design ZIP and the enterprise case
 * library submit. Paths stay inside the package root.
 *
 * Author: Damon Li
 */

export const VIEW_PACKAGE_FORMAT = "agx-view-package/1" as const;

export type ViewPackageDevice = "desktop" | "tablet" | "phone";
export type ViewPackageKind = "html" | "image";

export type ViewPackagePage = {
  id: string;
  file: string;
  title: string;
  device: ViewPackageDevice;
  kind: ViewPackageKind;
  x: number;
  y: number;
};

export type ViewPackageManifest = {
  name: string;
  version: string;
  format: typeof VIEW_PACKAGE_FORMAT;
  pages: ViewPackagePage[];
};

export type ViewPackageSource = {
  id: string;
  title: string;
  absolutePath: string;
  device: ViewPackageDevice;
  kind?: ViewPackageKind;
  x: number;
  y: number;
};

export type ViewPackageEntry = {
  absolutePath: string;
  zipName: string;
};

const DEVICES = new Set<ViewPackageDevice>(["desktop", "tablet", "phone"]);

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function parentDir(filePath: string): string {
  const norm = normalizeSlashes(filePath);
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "";
  return norm.slice(0, idx);
}

function baseName(filePath: string): string {
  const norm = normalizeSlashes(filePath);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function commonDirectory(paths: string[]): string {
  const dirs = paths.map(parentDir);
  if (dirs.length === 0) return "";
  let prefix = dirs[0] ?? "";
  for (const dir of dirs.slice(1)) {
    while (prefix && dir !== prefix && !dir.startsWith(`${prefix}/`)) {
      const idx = prefix.lastIndexOf("/");
      prefix = idx <= 0 ? "" : prefix.slice(0, idx);
    }
  }
  return prefix;
}

function packageRoot(paths: string[]): string {
  const shared = commonDirectory(paths);
  const parents = new Set(paths.map(parentDir));
  if (parents.size === 1 && shared) {
    const above = parentDir(shared);
    if (above) return above;
  }
  return shared;
}

function relativeTo(root: string, filePath: string): string {
  const norm = normalizeSlashes(filePath);
  const base = root.replace(/\/$/, "");
  if (base && (norm === base || norm.startsWith(`${base}/`))) {
    const rel = norm === base ? baseName(norm) : norm.slice(base.length + 1);
    return rel || baseName(norm);
  }
  return baseName(norm);
}

function uniqueZipName(preferred: string, used: Map<string, number>): string {
  const key = preferred.toLowerCase();
  const seen = used.get(key) ?? 0;
  used.set(key, seen + 1);
  if (seen === 0) return preferred;
  const slash = preferred.lastIndexOf("/");
  const dir = slash >= 0 ? preferred.slice(0, slash + 1) : "";
  const name = slash >= 0 ? preferred.slice(slash + 1) : preferred;
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    return `${dir}${name.slice(0, dot)}-${seen + 1}${name.slice(dot)}`;
  }
  return `${dir}${name}-${seen + 1}`;
}

export function planViewPackage(
  sources: ViewPackageSource[],
  options?: { name?: string; version?: string },
): { manifest: ViewPackageManifest; entries: ViewPackageEntry[] } {
  const usable = sources.filter((source) => source.absolutePath.trim() && source.id.trim());
  const root = packageRoot(usable.map((source) => source.absolutePath));
  const used = new Map<string, number>();
  const entries: ViewPackageEntry[] = [];
  const pages: ViewPackagePage[] = [];
  for (const source of usable) {
    const preferred = relativeTo(root, source.absolutePath).replace(/^\/+/, "");
    const zipName = uniqueZipName(preferred || "page.html", used);
    entries.push({ absolutePath: source.absolutePath, zipName });
    const device = DEVICES.has(source.device) ? source.device : "desktop";
    pages.push({
      id: source.id,
      file: zipName,
      title: source.title.trim() || baseName(zipName),
      device,
      kind: source.kind === "image" ? "image" : "html",
      x: Number.isFinite(source.x) ? source.x : 0,
      y: Number.isFinite(source.y) ? source.y : 0,
    });
  }
  const folder = root ? baseName(root) : "";
  return {
    manifest: {
      name: (options?.name ?? folder ?? "design").trim() || "design",
      version: (options?.version ?? "1.0.0").trim() || "1.0.0",
      format: VIEW_PACKAGE_FORMAT,
      pages,
    },
    entries,
  };
}

export function joinPackagePath(root: string, relativeFile: string): string {
  const clean = normalizeSlashes(relativeFile).replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("package path escapes the root");
  }
  const base = root.replace(/[/\\]+$/, "");
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${base}${sep}${clean.split("/").join(sep)}`;
}

export function parseViewPackageManifest(raw: unknown): ViewPackageManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest is not an object");
  const record = raw as Record<string, unknown>;
  if (record.format !== VIEW_PACKAGE_FORMAT) {
    throw new Error(`unsupported package format: ${String(record.format ?? "")}`);
  }
  if (!Array.isArray(record.pages)) throw new Error("manifest has no pages");
  const pages: ViewPackagePage[] = [];
  for (const item of record.pages) {
    if (!item || typeof item !== "object") continue;
    const page = item as Record<string, unknown>;
    const id = String(page.id ?? "").trim();
    const file = String(page.file ?? "").trim();
    if (!id || !file) continue;
    const device = String(page.device ?? "desktop");
    pages.push({
      id,
      file,
      title: String(page.title ?? "").trim() || baseName(file),
      device: DEVICES.has(device as ViewPackageDevice) ? (device as ViewPackageDevice) : "desktop",
      kind: page.kind === "image" ? "image" : "html",
      x: typeof page.x === "number" && Number.isFinite(page.x) ? page.x : 0,
      y: typeof page.y === "number" && Number.isFinite(page.y) ? page.y : 0,
    });
  }
  if (pages.length === 0) throw new Error("manifest has no pages");
  return {
    name: String(record.name ?? "design").trim() || "design",
    version: String(record.version ?? "1.0.0").trim() || "1.0.0",
    format: VIEW_PACKAGE_FORMAT,
    pages,
  };
}

export function framesFromManifest(
  manifest: ViewPackageManifest,
  rootDir: string,
): Array<ViewPackageSource & { absolutePath: string }> {
  return manifest.pages.map((page) => ({
    id: page.id,
    title: page.title,
    absolutePath: joinPackagePath(rootDir, page.file),
    device: page.device,
    kind: page.kind,
    x: page.x,
    y: page.y,
  }));
}
