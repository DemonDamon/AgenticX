/**
 * Session workspace mount helpers (link / copy / reference metadata).
 *
 * Author: Damon Li
 */

import fs from "node:fs";
import path from "node:path";

import { isRealpathUnder, safeRealpath } from "./path-guard";

export type MountMode = "reference" | "copy" | "link";

export type MountRecord = {
  name: string;
  mode: MountMode;
  source_path: string;
  linked_at: number;
  /** Present for copy mode: relative path of copy under default dir. */
  copy_rel?: string;
};

export type CopyFileMeta = {
  rel: string;
  size: number;
  mtimeMs: number;
};

export type CopyManifest = {
  version: 1;
  name: string;
  source_path: string;
  copied_at: number;
  files: CopyFileMeta[];
};

export const MOUNTS_FILENAME = ".agx-mounts.json";
export const COPY_MANIFEST_FILENAME = ".agx-copy-manifest.json";

const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".venv", "__pycache__"]);
export const COPY_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const COPY_MAX_FILE_COUNT = 5000;

export function mountsPath(defaultDir: string): string {
  return path.join(defaultDir, MOUNTS_FILENAME);
}

export function copyManifestPath(defaultDir: string): string {
  return path.join(defaultDir, COPY_MANIFEST_FILENAME);
}

export async function readMounts(defaultDir: string): Promise<MountRecord[]> {
  const file = mountsPath(defaultDir);
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { mounts?: MountRecord[] };
    if (!Array.isArray(parsed?.mounts)) return [];
    return parsed.mounts.filter(
      (m) => m && typeof m.name === "string" && typeof m.source_path === "string",
    );
  } catch {
    return [];
  }
}

export async function writeMounts(defaultDir: string, mounts: MountRecord[]): Promise<void> {
  const file = mountsPath(defaultDir);
  await fs.promises.writeFile(
    file,
    JSON.stringify({ version: 1, mounts }, null, 2) + "\n",
    "utf8",
  );
}

export async function upsertMount(defaultDir: string, record: MountRecord): Promise<void> {
  const mounts = await readMounts(defaultDir);
  const next = mounts.filter((m) => m.name !== record.name);
  next.push(record);
  await writeMounts(defaultDir, next);
}

function isDirectChild(parentDir: string, childPath: string): boolean {
  return path.dirname(path.resolve(childPath)) === path.resolve(parentDir);
}

/** Remove a mount by source path. Link/copy dest under defaultDir is deleted; source is not. */
export async function removeMountForSource(
  defaultDir: string,
  sourcePath: string,
): Promise<{ ok: boolean; removed: boolean; name?: string }> {
  const record = await findMountForSource(defaultDir, sourcePath);
  if (!record) return { ok: true, removed: false };
  if (record.mode !== "reference") {
    const dest = path.join(defaultDir, record.name);
    if (isDirectChild(defaultDir, dest)) {
      await fs.promises.rm(dest, { recursive: true, force: true });
    }
  }
  const mounts = await readMounts(defaultDir);
  await writeMounts(
    defaultDir,
    mounts.filter((item) => item.name !== record.name),
  );
  return { ok: true, removed: true, name: record.name };
}

/** Find an existing mount by canonical source path (or basename match). */
export async function findMountForSource(
  defaultDir: string,
  sourcePath: string,
): Promise<MountRecord | null> {
  const mounts = await readMounts(defaultDir);
  const want = path.resolve(sourcePath);
  for (const m of mounts) {
    if (path.resolve(m.source_path) === want) return m;
  }
  const base = path.basename(want);
  return mounts.find((m) => m.name === base) ?? null;
}

/** Find a reference/copy mount whose source covers `sourcePath` (self or ancestor). */
export async function findCoveringNonLinkMount(
  defaultDir: string,
  sourcePath: string,
): Promise<MountRecord | null> {
  const mounts = await readMounts(defaultDir);
  for (const m of mounts) {
    if (!m || m.mode === "link") continue;
    if (await isRealpathUnder(sourcePath, m.source_path)) {
      return m;
    }
  }
  return null;
}

export function uniqueLinkName(destDir: string, sourcePath: string, used: Set<string>): string {
  const base = path.basename(sourcePath) || "item";
  if (!used.has(base) && !fs.existsSync(path.join(destDir, base))) {
    used.add(base);
    return base;
  }
  const parent = path.basename(path.dirname(sourcePath)) || "dir";
  const alt = `${parent}_${base}`;
  if (!used.has(alt) && !fs.existsSync(path.join(destDir, alt))) {
    used.add(alt);
    return alt;
  }
  let i = 2;
  while (used.has(`${i}_${base}`) || fs.existsSync(path.join(destDir, `${i}_${base}`))) {
    i += 1;
  }
  const finalName = `${i}_${base}`;
  used.add(finalName);
  return finalName;
}

/** Symlink type for directories: junction on Windows, dir elsewhere. */
export function symlinkTypeForDirectory(platform: NodeJS.Platform = process.platform): "junction" | "dir" {
  return platform === "win32" ? "junction" : "dir";
}

/**
 * Create a file/dir symlink (or Windows junction for directories).
 * Returns ok/error; does not throw for symlink failures.
 */
export async function createWorkspaceLink(opts: {
  source: string;
  dest: string;
  isDirectory: boolean;
  platform?: NodeJS.Platform;
  symlinkFn?: typeof fs.promises.symlink;
}): Promise<{ ok: boolean; error?: string }> {
  const symlink = opts.symlinkFn ?? fs.promises.symlink.bind(fs.promises);
  const platform = opts.platform ?? process.platform;
  const resolvedSource = path.resolve(opts.source);
  try {
    if (opts.isDirectory) {
      await symlink(resolvedSource, opts.dest, symlinkTypeForDirectory(platform));
    } else {
      await symlink(resolvedSource, opts.dest, "file");
    }
    return { ok: true };
  } catch (err) {
    try {
      await symlink(resolvedSource, opts.dest);
      return { ok: true };
    } catch (err2) {
      return { ok: false, error: String(err2 || err) };
    }
  }
}

async function walkCopyPlan(
  sourceRoot: string,
  relBase = "",
  limits: { maxTotalBytes: number; maxFileCount: number } = {
    maxTotalBytes: COPY_MAX_TOTAL_BYTES,
    maxFileCount: COPY_MAX_FILE_COUNT,
  },
): Promise<{ files: Array<{ abs: string; rel: string; size: number; mtimeMs: number }>; error?: string }> {
  const out: Array<{ abs: string; rel: string; size: number; mtimeMs: number }> = [];
  let totalBytes = 0;

  const walk = async (absDir: string, relDir: string): Promise<string | undefined> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      return String(err);
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      let st: fs.Stats;
      try {
        st = await fs.promises.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const err = await walk(abs, rel);
        if (err) return err;
        continue;
      }
      if (!st.isFile()) continue;
      totalBytes += st.size;
      if (totalBytes > limits.maxTotalBytes) {
        return `copy exceeds size limit (${limits.maxTotalBytes} bytes)`;
      }
      out.push({ abs, rel, size: st.size, mtimeMs: st.mtimeMs });
      if (out.length > limits.maxFileCount) {
        return `copy exceeds file count limit (${limits.maxFileCount})`;
      }
    }
    return undefined;
  };

  const sourceStat = await fs.promises.lstat(sourceRoot);
  if (sourceStat.isFile()) {
    out.push({
      abs: sourceRoot,
      rel: path.basename(sourceRoot),
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
    });
    if (sourceStat.size > limits.maxTotalBytes) {
      return { files: [], error: `copy exceeds size limit (${limits.maxTotalBytes} bytes)` };
    }
    return { files: out };
  }

  const err = await walk(sourceRoot, relBase);
  return { files: out, error: err };
}

export async function copySourceIntoWorkspace(opts: {
  defaultDir: string;
  source: string;
  destName: string;
  maxTotalBytes?: number;
  maxFileCount?: number;
}): Promise<{ ok: boolean; dest?: string; error?: string; manifest?: CopyManifest }> {
  const sourceReal = await safeRealpath(opts.source);
  if (await isRealpathUnder(sourceReal, opts.defaultDir)) {
    return { ok: false, error: "source is already under session workspace" };
  }
  const dest = path.join(opts.defaultDir, opts.destName);
  if (fs.existsSync(dest)) {
    return { ok: false, error: `destination already exists: ${opts.destName}` };
  }

  const limits = {
    maxTotalBytes: opts.maxTotalBytes ?? COPY_MAX_TOTAL_BYTES,
    maxFileCount: opts.maxFileCount ?? COPY_MAX_FILE_COUNT,
  };
  const st = await fs.promises.lstat(sourceReal);
  const plan = await walkCopyPlan(
    sourceReal,
    st.isDirectory() ? "" : path.basename(sourceReal),
    limits,
  );
  if (plan.error) return { ok: false, error: plan.error };

  if (st.isDirectory()) {
    await fs.promises.mkdir(dest, { recursive: true });
    for (const file of plan.files) {
      const target = path.join(dest, file.rel);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(file.abs, target);
    }
  } else {
    await fs.promises.copyFile(sourceReal, dest);
  }

  const manifest: CopyManifest = {
    version: 1,
    name: opts.destName,
    source_path: sourceReal,
    copied_at: Date.now(),
    files: plan.files.map((f) => ({
      rel: st.isDirectory() ? f.rel : ".",
      size: f.size,
      mtimeMs: f.mtimeMs,
    })),
  };

  // Append to multi-entry copy manifest file.
  const all = await readCopyManifests(opts.defaultDir);
  const next = all.filter((m) => m.name !== opts.destName);
  next.push(manifest);
  await fs.promises.writeFile(
    copyManifestPath(opts.defaultDir),
    JSON.stringify({ version: 1, copies: next }, null, 2) + "\n",
    "utf8",
  );

  return { ok: true, dest, manifest };
}

export async function readCopyManifests(defaultDir: string): Promise<CopyManifest[]> {
  try {
    const raw = await fs.promises.readFile(copyManifestPath(defaultDir), "utf8");
    const parsed = JSON.parse(raw) as { copies?: CopyManifest[] };
    return Array.isArray(parsed?.copies) ? parsed.copies : [];
  } catch {
    return [];
  }
}

export type CopyDiffResult = {
  ok: boolean;
  name: string;
  source_path: string;
  added: string[];
  modified: string[];
  deleted: string[];
  source_drifted: boolean;
  error?: string;
};

async function listCopyTree(
  copyRoot: string,
  isFileCopy: boolean,
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const map = new Map<string, { size: number; mtimeMs: number }>();
  if (isFileCopy) {
    const st = await fs.promises.stat(copyRoot);
    map.set(".", { size: st.size, mtimeMs: st.mtimeMs });
    return map;
  }
  const walk = async (absDir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      let st: fs.Stats;
      try {
        st = await fs.promises.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (st.isFile()) {
        map.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  await walk(copyRoot, "");
  return map;
}

export async function diffSessionWorkspaceCopy(opts: {
  defaultDir: string;
  name: string;
}): Promise<CopyDiffResult> {
  const manifests = await readCopyManifests(opts.defaultDir);
  const manifest = manifests.find((m) => m.name === opts.name);
  if (!manifest) {
    return {
      ok: false,
      name: opts.name,
      source_path: "",
      added: [],
      modified: [],
      deleted: [],
      source_drifted: false,
      error: "copy manifest not found",
    };
  }
  const copyRoot = path.join(opts.defaultDir, opts.name);
  if (!fs.existsSync(copyRoot)) {
    return {
      ok: false,
      name: opts.name,
      source_path: manifest.source_path,
      added: [],
      modified: [],
      deleted: [],
      source_drifted: false,
      error: "copy destination missing",
    };
  }
  const isFileCopy = (await fs.promises.stat(copyRoot)).isFile();
  const current = await listCopyTree(copyRoot, isFileCopy);
  const baseline = new Map(manifest.files.map((f) => [f.rel, f]));

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [rel, meta] of current) {
    const base = baseline.get(rel);
    if (!base) {
      added.push(rel);
      continue;
    }
    if (base.size !== meta.size || Math.abs(base.mtimeMs - meta.mtimeMs) > 1) {
      // Content change: compare bytes for files that still exist in baseline.
      const copyPath = isFileCopy ? copyRoot : path.join(copyRoot, rel);
      const srcPath = isFileCopy
        ? manifest.source_path
        : path.join(manifest.source_path, rel);
      try {
        const [a, b] = await Promise.all([
          fs.promises.readFile(copyPath),
          fs.promises.readFile(srcPath).catch(() => null),
        ]);
        // Prefer byte compare vs original source snapshot isn't stored; use size/mtime vs baseline.
        void a;
        void b;
        if (base.size !== meta.size || base.mtimeMs !== meta.mtimeMs) {
          modified.push(rel);
        }
      } catch {
        modified.push(rel);
      }
    }
  }
  for (const rel of baseline.keys()) {
    if (!current.has(rel)) deleted.push(rel);
  }

  let source_drifted = false;
  try {
    if (isFileCopy) {
      const src = await fs.promises.stat(manifest.source_path);
      const base = manifest.files[0];
      if (base && (src.size !== base.size || Math.abs(src.mtimeMs - base.mtimeMs) > 1)) {
        source_drifted = true;
      }
    } else {
      for (const f of manifest.files) {
        const srcPath = path.join(manifest.source_path, f.rel);
        try {
          const st = await fs.promises.stat(srcPath);
          if (st.size !== f.size || Math.abs(st.mtimeMs - f.mtimeMs) > 1) {
            source_drifted = true;
            break;
          }
        } catch {
          source_drifted = true;
          break;
        }
      }
    }
  } catch {
    source_drifted = true;
  }

  return {
    ok: true,
    name: opts.name,
    source_path: manifest.source_path,
    added,
    modified,
    deleted,
    source_drifted,
  };
}

export async function applySessionWorkspaceCopy(opts: {
  defaultDir: string;
  name: string;
  force?: boolean;
}): Promise<{ ok: boolean; applied: string[]; error?: string; source_drifted?: boolean }> {
  const diff = await diffSessionWorkspaceCopy({ defaultDir: opts.defaultDir, name: opts.name });
  if (!diff.ok) return { ok: false, applied: [], error: diff.error };
  if (diff.source_drifted && !opts.force) {
    return {
      ok: false,
      applied: [],
      source_drifted: true,
      error: "source drifted since copy; confirm force apply to overwrite",
    };
  }
  const copyRoot = path.join(opts.defaultDir, opts.name);
  const isFileCopy = (await fs.promises.stat(copyRoot)).isFile();
  const applied: string[] = [];

  for (const rel of [...diff.added, ...diff.modified]) {
    const from = isFileCopy ? copyRoot : path.join(copyRoot, rel);
    const to = isFileCopy ? diff.source_path : path.join(diff.source_path, rel);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await fs.promises.copyFile(from, to);
    applied.push(rel);
  }
  for (const rel of diff.deleted) {
    if (isFileCopy) continue;
    const to = path.join(diff.source_path, rel);
    try {
      await fs.promises.unlink(to);
      applied.push(rel);
    } catch {
      // ignore missing
    }
  }
  return { ok: true, applied, source_drifted: diff.source_drifted };
}
