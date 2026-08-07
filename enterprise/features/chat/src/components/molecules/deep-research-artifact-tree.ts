export type ArtifactListItem = {
  id: string;
  path: string;
  title: string;
  kind: string;
  byteSize: number;
  mimeType?: string;
};

/** True for HTML / Word-HTML (.doc) deliverables that must render in an iframe, not as markdown. */
export function isHtmlArtifact(
  item: Pick<ArtifactListItem, "path" | "mimeType"> | null | undefined,
): boolean {
  if (!item) return false;
  const mime = (item.mimeType ?? "").toLowerCase();
  if (mime.includes("html") || mime.includes("msword") || mime.includes("word")) {
    return true;
  }
  const path = item.path.toLowerCase();
  return path.endsWith(".html") || path.endsWith(".doc");
}

/**
 * Portal-only CSS/JS for already-saved report.html that still stacks a full TOC
 * above the article under `@media (max-width: 860px)`.
 * Mid widths keep a thin left TOC; very narrow collapses TOC by default.
 */
const PORTAL_TOC_NARROW_PATCH = `
<style id="agx-portal-toc-narrow">
/* Theme is controlled by the panel toolbar — hide the in-document control. */
.theme-toggle { display: none !important; }
@media (max-width: 860px) and (min-width: 521px) {
  .layout { flex-direction: row !important; }
  .sidebar {
    position: sticky !important; top: 0 !important; align-self: flex-start !important;
    width: 180px !important; max-height: 100vh !important; overflow: auto !important;
    border-right: 1px solid var(--border) !important; border-bottom: none !important;
  }
  .sidebar .toc { display: block !important; }
  .sidebar > h2 { cursor: default; }
  .sidebar > h2::after { content: none !important; }
  .main { padding: 1.5rem 1.25rem 3rem !important; }
}
@media (max-width: 520px) {
  .layout { flex-direction: column !important; }
  .sidebar {
    position: sticky !important; top: 0 !important; z-index: 10 !important;
    width: 100% !important; max-height: none !important;
    border-right: none !important; border-bottom: 1px solid var(--border) !important;
  }
  .sidebar:not(.toc-open) .toc { display: none !important; }
  .sidebar.toc-open .toc {
    display: block !important; max-height: min(50vh, 20rem) !important; overflow: auto !important;
  }
  .sidebar > h2 {
    cursor: pointer !important; user-select: none; margin-bottom: 0 !important;
    display: flex !important; align-items: center; justify-content: space-between;
  }
  .sidebar > h2::after {
    content: "▸" !important; color: var(--muted); font-size: 0.85rem;
  }
  .sidebar.toc-open > h2 { margin-bottom: 0.75rem !important; }
  .sidebar.toc-open > h2::after { content: "▾" !important; }
  .main { padding: 1.25rem 1.25rem 3rem !important; }
}
</style>
<script id="agx-portal-toc-narrow-js">
(function () {
  if (window.__agxPortalTocNarrow) return;
  window.__agxPortalTocNarrow = true;
  var sidebar = document.getElementById("toc") || document.querySelector(".sidebar");
  var narrowMq = window.matchMedia("(max-width: 520px)");
  function sync() {
    if (!sidebar) return;
    if (!narrowMq.matches) sidebar.classList.remove("toc-open");
  }
  if (sidebar) {
    var heading = sidebar.querySelector(":scope > h2");
    if (heading && !heading.dataset.agxTocBound) {
      heading.dataset.agxTocBound = "1";
      heading.addEventListener("click", function () {
        if (!narrowMq.matches) return;
        sidebar.classList.toggle("toc-open");
      });
    }
    if (narrowMq.addEventListener) narrowMq.addEventListener("change", sync);
    else if (narrowMq.addListener) narrowMq.addListener(sync);
    sync();
  }
  // srcDoc hash links otherwise navigate the parent portal (often to login).
  if (!window.__agxPortalHashNav) {
    window.__agxPortalHashNav = true;
    function scrollToHash(href) {
      if (!href || href.charAt(0) !== "#") return false;
      var id = href.slice(1);
      try { id = decodeURIComponent(id); } catch (e) {}
      if (!id) return false;
      var target = document.getElementById(id);
      if (!target) return false;
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        target.scrollIntoView(true);
      }
      if (id.indexOf("ref-") === 0) {
        target.classList.add("flash");
        setTimeout(function () { target.classList.remove("flash"); }, 1200);
      }
      return true;
    }
    document.addEventListener("click", function (event) {
      var node = event.target;
      var a = null;
      while (node && node !== document) {
        if (node.tagName === "A") { a = node; break; }
        node = node.parentNode;
      }
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (href.charAt(0) !== "#") return;
      // Always stop hash navigation escaping the sandbox (bare hash or missing targets).
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      scrollToHash(href);
    }, true);
  }
})();
</script>
`.trim();

function stampHtmlDarkClass(html: string, dark: boolean): string {
  const match = html.match(/<html(\s[^>]*)?>/i);
  if (!match || match.index === undefined) return html;
  const openTag = match[0];
  const attrs = match[1] ?? "";
  const classMatch = attrs.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);

  let nextAttrs = attrs;
  if (classMatch) {
    const quote = classMatch[1]!;
    const tokens = classMatch[2]!
      .split(/\s+/)
      .filter((token) => token && token !== "dark");
    if (dark) tokens.push("dark");
    if (tokens.length === 0) {
      nextAttrs = attrs.replace(/\s*\bclass\s*=\s*(["'])([^"']*)\1/i, "");
    } else {
      nextAttrs = attrs.replace(
        /\bclass\s*=\s*(["'])([^"']*)\1/i,
        `class=${quote}${tokens.join(" ")}${quote}`,
      );
    }
  } else if (dark) {
    nextAttrs = `${attrs} class="dark"`;
  } else {
    return html;
  }

  const nextTag = `<html${nextAttrs}>`.replace(/\s+>/g, ">").replace(/^<html\s{2,}/, "<html ");
  return html.slice(0, match.index) + nextTag + html.slice(match.index + openTag.length);
}

function injectPortalTocNarrowPatch(html: string): string {
  if (html.includes('id="agx-portal-toc-narrow"')) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${PORTAL_TOC_NARROW_PATCH}\n</head>`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${PORTAL_TOC_NARROW_PATCH}\n</body>`);
  }
  return `${html}\n${PORTAL_TOC_NARROW_PATCH}`;
}

/**
 * Repair already-saved report.html where citation anchors were wrongly sanitized
 * from `#ref-N` to bare `#` (label remains the citation index).
 */
export function repairBrokenCitationHrefs(html: string): string {
  return html.replace(/<a href="#">(\d{1,3})<\/a>/g, (match, n: string) => {
    const id = `ref-${n}`;
    if (html.includes(`id="${id}"`)) {
      return `<a href="#${id}">${n}</a>`;
    }
    return match;
  });
}

/**
 * Align sandboxed report.html srcDoc with the portal theme.
 * Sandbox without allow-same-origin cannot read localStorage / parent CSS vars,
 * so we stamp `class="dark"` onto <html> before handing it to the iframe.
 * Also patches narrow-viewport TOC stacking for already-saved report.html files.
 * Empty content returns "" so the panel does not paint a blank white iframe.
 */
export function prepareHtmlPreviewSrcDoc(html: string, dark: boolean): string {
  const raw = html ?? "";
  if (!raw.trim()) return "";
  const repaired = repairBrokenCitationHrefs(raw);
  const stamped = stampHtmlDarkClass(repaired, dark);
  return injectPortalTocNarrowPatch(stamped);
}

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

type ArtifactFileNode = Extract<ArtifactTreeNode, { type: "file" }>;

/** Pure 16-hex legacy page archives (pre readable-slug naming). */
const HEX_PAGE_NAME = /^[0-9a-f]{16}\.md$/i;

/**
 * Browse-list label for a file node.
 * Prefer artifact.title for pages/ (and legacy hex-only names) so users see
 * the source title instead of a content-hash filename.
 */
function isPrimaryReportFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower === "final-report.md" ||
    lower === "report.md" ||
    lower === "report.html" ||
    lower === "report.doc"
  );
}

/** Known research/ run folder segments → Chinese browse labels. */
const ARTIFACT_DIR_LABELS: Record<string, string> = {
  lanes: "调研车道",
  pages: "网页正文",
  assets: "资源",
};

/** Map internal path segments (lanes/pages) to UI Chinese names. */
export function displayNameForArtifactDir(name: string): string {
  const key = name.trim().toLowerCase();
  return ARTIFACT_DIR_LABELS[key] ?? name;
}

/** Secondary line for a collapsed single-file folder (avoid raw memo.md). */
export function displaySubtitleForCollapsedFile(
  fileName: string,
  byteSize: number,
): string {
  const base = fileName.split("/").pop()?.toLowerCase() ?? fileName.toLowerCase();
  const kind =
    base === "memo.md"
      ? "备忘"
      : base.endsWith(".html")
        ? "网页报告"
        : base.endsWith(".md")
          ? "文档"
          : "文件";
  return `${kind} · ${formatArtifactByteSize(byteSize)}`;
}

export function displayNameForArtifactFile(
  fileName: string,
  artifact: Pick<ArtifactListItem, "path" | "title">,
): string {
  const title = artifact.title?.trim();
  if (!title) return fileName;
  const underPages = artifact.path.includes("/pages/");
  // Prefer human titles for pages AND primary report deliverables so users who
  // asked for HTML do not land on a cryptic `final-report.md` label.
  if (underPages || HEX_PAGE_NAME.test(fileName) || isPrimaryReportFileName(fileName)) {
    const safe = title
      .normalize("NFKC")
      .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9._\- ]+/g, "")
      .trim()
      .slice(0, 60);
    if (!safe) return fileName;
    const lower = safe.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".html") || lower.endsWith(".doc")) {
      return safe;
    }
    const ext = fileName.toLowerCase().endsWith(".html") ? ".html" : ".md";
    return `${safe}${ext}`;
  }
  return fileName;
}

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
      const rawFileName = only.artifact.path.split("/").pop() || only.name;
      return {
        type: "file",
        key: only.key,
        name: node.name,
        subtitle: displaySubtitleForCollapsedFile(rawFileName, only.artifact.byteSize),
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
    children: Map<string, DirDraft | ArtifactFileNode>;
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
      const existing = cursor.children.get(name);
      const next: DirDraft =
        existing && existing.type === "dir"
          ? existing
          : { type: "dir", key, name, children: new Map() };
      if (!existing || existing.type !== "dir") {
        cursor.children.set(name, next);
      }
      cursor = next;
    }

    const fileName = parts[parts.length - 1]!;
    const fileKey = parts.join("/");
    cursor.children.set(fileName, {
      type: "file",
      key: fileKey,
      name: displayNameForArtifactFile(fileName, artifact),
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
        name: displayNameForArtifactDir(child.name),
        byteSize,
        fileCount: countFiles(children),
        children,
      });
    }
    // Deliverable reports first (html before md), then other files, then folders.
    const rank = (node: ArtifactTreeNode): number => {
      if (node.type === "dir") return 50;
      const base = (node.artifact.path.split("/").pop() || node.name).toLowerCase();
      if (base === "report.html") return 0;
      if (base === "final-report.md") return 1;
      if (base === "report.md") return 2;
      return 10;
    };
    return nodes.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  };

  return collapseSingleFileDirs(finalize(root));
}
