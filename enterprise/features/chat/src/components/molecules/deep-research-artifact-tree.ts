export type ArtifactListItem = {
  id: string;
  path: string;
  title: string;
  kind: string;
  byteSize: number;
  mimeType?: string;
};

export type ArtifactTreeNode =
  | {
      type: "dir";
      /** Relative path key for expand state, e.g. `lanes` or `lanes/a` */
      key: string;
      name: string;
      byteSize: number;
      fileCount: number;
      children: ArtifactTreeNode[];
    }
  | {
      type: "file";
      key: string;
      name: string;
      /** Optional context line, e.g. parent lane title when a wrapper dir was collapsed. */
      subtitle?: string;
      artifact: ArtifactListItem;
    };

/** Format byte size like "25.87 KB". */
export function formatArtifactByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(2)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(2)} MB`;
}

function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => p.split("/").filter(Boolean));
  const first = split[0]!;
  let end = first.length;
  for (let i = 1; i < split.length; i += 1) {
    const parts = split[i]!;
    let j = 0;
    while (j < end && j < parts.length && parts[j] === first[j]) j += 1;
    end = j;
  }
  // Keep at least the filename segment of each path outside the prefix.
  const maxPrefix = Math.max(0, Math.min(...split.map((p) => p.length - 1)));
  end = Math.min(end, maxPrefix);
  return end > 0 ? `${first.slice(0, end).join("/")}/` : "";
}

function countFiles(nodes: ArtifactTreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "file") n += 1;
    else n += node.fileCount;
  }
  return n;
}

/**
 * Collapse directories that only wrap a single file (common for lane memos):
 * `lanes/q1-long-title/memo.md` → one file row titled with the lane name.
 */
export function collapseSingleFileDirs(nodes: ArtifactTreeNode[]): ArtifactTreeNode[] {
  return nodes.map((node) => {
    if (node.type === "file") return node;
    const children = collapseSingleFileDirs(node.children);
    if (children.length === 1 && children[0]?.type === "file") {
      const only = children[0];
      return {
        type: "file",
        key: only.key,
        name: node.name,
        subtitle: `${only.name} · ${formatArtifactByteSize(only.artifact.byteSize)}`,
        artifact: only.artifact,
      };
    }
    const byteSize = children.reduce(
      (sum, n) => sum + (n.type === "file" ? n.artifact.byteSize : n.byteSize),
      0,
    );
    return {
      type: "dir",
      key: node.key,
      name: node.name,
      byteSize,
      fileCount: countFiles(children),
      children,
    };
  });
}

/** Zip entry path relative to the shared research/<runId>/ prefix when possible. */
export function artifactZipEntryPath(artifact: ArtifactListItem, all: ArtifactListItem[]): string {
  const prefix = commonPathPrefix(all.map((a) => a.path));
  if (prefix && artifact.path.startsWith(prefix)) {
    return artifact.path.slice(prefix.length) || artifact.path.split("/").pop() || "file.md";
  }
  return artifact.path.replace(/^\//, "") || "file.md";
}

/**
 * Build a browse tree from flat artifact paths.
 * Strips the shared directory prefix so the list starts near the deliverables
 * (e.g. `final-report.md` + `lanes/…` under `research/<runId>/`).
 */
export function buildArtifactTree(artifacts: ArtifactListItem[]): ArtifactTreeNode[] {
  const sorted = [...artifacts].sort((a, b) => a.path.localeCompare(b.path));
  const prefix = commonPathPrefix(sorted.map((a) => a.path));

  type DirDraft = {
    type: "dir";
    key: string;
    name: string;
    children: Map<string, DirDraft | ArtifactTreeNode>;
  };

  const root: DirDraft = { type: "dir", key: "", name: "", children: new Map() };

  for (const artifact of sorted) {
    const relative = prefix && artifact.path.startsWith(prefix)
      ? artifact.path.slice(prefix.length)
      : artifact.path.replace(/^\//, "");
    const parts = relative.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]!;
      const key = parts.slice(0, i + 1).join("/");
      let next = cursor.children.get(name);
      if (!next || next.type !== "dir") {
        next = { type: "dir", key, name, children: new Map() };
        cursor.children.set(name, next);
      }
      cursor = next;
    }

    const fileName = parts[parts.length - 1]!;
    const fileKey = parts.join("/");
    cursor.children.set(fileName, {
      type: "file",
      key: fileKey,
      name: fileName,
      artifact,
    });
  }

  const finalize = (draft: DirDraft): ArtifactTreeNode[] => {
    const nodes: ArtifactTreeNode[] = [];
    const entries = [...draft.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [, child] of entries) {
      if (child.type === "file") {
        nodes.push(child);
        continue;
      }
      const children = finalize(child);
      const byteSize = children.reduce(
        (sum, n) => sum + (n.type === "file" ? n.artifact.byteSize : n.byteSize),
        0,
      );
      nodes.push({
        type: "dir",
        key: child.key,
        name: child.name,
        byteSize,
        fileCount: countFiles(children),
        children,
      });
    }
    // Folders first, then files — closer to a finder / Kimi listing.
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };

  return collapseSingleFileDirs(finalize(root));
}
