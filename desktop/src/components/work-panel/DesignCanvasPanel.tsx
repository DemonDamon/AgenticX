/**
 * Design Canvas — Trae「设计画布」对标面板。
 *
 * 在 WorkPanel 内提供一块可平移 / 缩放的无限画布，AI 生成的 HTML 设计稿
 * 以「画框」形式平铺预览（桌面 / 平板 / 手机三档尺寸），复用
 * HtmlPreviewBody 的 srcDoc 沙箱渲染（相对资源内联、主题注入、存储桥接）。
 * 画框对应文件在磁盘上变更时自动刷新。
 *
 * Author: Damon Li
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Frame as FrameIcon,
  Image as ImageIcon,
  LayoutGrid,
  Maximize,
  MessageCircle,
  Minus,
  Monitor,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { HtmlPreviewBody } from "../workspace/HtmlPreviewBody";
import { loadPreparedHtmlSrcDoc } from "../../utils/html-preview-assets";
import { artifactBaseName, isInAppHtmlPreviewPath } from "../../utils/session-artifacts";
import {
  applyEditsToHtmlSource,
  composeEditorStyle,
  parseMatrixTransform,
  parsePx,
  type CanvasEditorSelectPayload,
  type CanvasEditorStyleMap,
  type CanvasStyleEdits,
} from "../../utils/canvas-visual-editor";
import { HoverTip } from "../ds/HoverTip";

export type CanvasDevice = "desktop" | "tablet" | "phone";

/** Frame content kind — undefined behaves as "html" (legacy in-memory frames). */
export type CanvasFrameKind = "html" | "image";

export type CanvasFrame = {
  id: string;
  title: string;
  absolutePath: string;
  kind?: CanvasFrameKind;
  device: CanvasDevice;
  /** World coordinates (unscaled px). */
  x: number;
  y: number;
  /** Bump to remount the iframe (manual refresh / external file change). */
  reloadNonce: number;
};

const DEVICE_SIZE: Record<CanvasDevice, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  phone: { width: 390, height: 844 },
};

/** Placeholder box for image frames until the natural size is known. */
const IMAGE_FALLBACK_BOX = { width: 480, height: 320 };
/** Image frames are capped into this box, natural aspect preserved. */
const IMAGE_MAX_BOX = { width: 1200, height: 900 };

function fitImageBox(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) return IMAGE_FALLBACK_BOX;
  const scale = Math.min(1, IMAGE_MAX_BOX.width / naturalWidth, IMAGE_MAX_BOX.height / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/** Body (below-titlebar) size of a frame; image frames use their loaded natural box. */
function frameBodySize(
  frame: CanvasFrame,
  imgSize?: { width: number; height: number },
): { width: number; height: number } {
  if (frame.kind === "image") return imgSize ?? IMAGE_FALLBACK_BOX;
  return DEVICE_SIZE[frame.device];
}

const FRAME_HEADER_H = 36;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2;
/** Trae-style canvas selection green (outline / floating bar / handles). */
const CANVAS_GREEN = "#34c759";

type CanvasView = { zoom: number; x: number; y: number };

type Props = {
  frames: CanvasFrame[];
  setFrames: (updater: (prev: CanvasFrame[]) => CanvasFrame[]) => void;
  /** Session artifact candidates; HTML entries become addable frames. */
  artifactCandidates: string[];
  onAddPath: (absolutePath: string) => void;
  onPickLocalFiles: () => void;
  /** Trae「导入图片素材」对标：打开图片文件选择器并落图片画框。 */
  onPickImageFiles: () => void;
  /** Trae「添加到对话」对标：把画框对应文件注入聊天输入区附件。返回 false 表示注入失败。 */
  onAddFrameToChat?: (frame: CanvasFrame) => boolean | void | Promise<boolean | void>;
};

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function zoomAt(view: CanvasView, zoomNext: number, clientX: number, clientY: number): CanvasView {
  const zoom = clampZoom(zoomNext);
  const ratio = zoom / view.zoom;
  return {
    zoom,
    x: clientX - (clientX - view.x) * ratio,
    y: clientY - (clientY - view.y) * ratio,
  };
}

const deviceIconClass = "h-3.5 w-3.5";

type CanvasEdge = { fromId: string; toId: string };

/** Resolve an in-page href against the frame's file path; null if not a local .html link. */
function resolveHtmlHref(baseFile: string, href: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^(https?:|mailto:|javascript:|data:|file:)/i.test(raw)) return null;
  const cleaned = raw.split("#")[0].split("?")[0];
  if (!/\.html?$/i.test(cleaned)) return null;
  const baseDir = baseFile.slice(0, Math.max(0, baseFile.lastIndexOf("/")));
  const src = cleaned.startsWith("/") ? cleaned : `${baseDir}/${cleaned}`;
  const out: string[] = [];
  for (const part of src.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/** Page-flow edges: a link inside frame A's HTML that points at frame B's file (like Trae's canvas). */
function deriveEdges(frames: CanvasFrame[], srcDocById: Record<string, string>): CanvasEdge[] {
  const idByPath = new Map(frames.map((f) => [f.absolutePath, f.id]));
  const edges: CanvasEdge[] = [];
  const seen = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  for (const frame of frames) {
    const doc = srcDocById[frame.id];
    if (!doc) continue;
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(doc)) !== null) {
      const resolved = resolveHtmlHref(frame.absolutePath, match[1]);
      if (!resolved) continue;
      const toId = idByPath.get(resolved);
      if (!toId || toId === frame.id) continue;
      const key = `${frame.id}->${toId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromId: frame.id, toId });
    }
  }
  return edges;
}

function frameBox(
  frame: CanvasFrame,
  imgSize?: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  const size = frameBodySize(frame, imgSize);
  return { x: frame.x, y: frame.y, w: size.width, h: size.height + FRAME_HEADER_H };
}

/** Horizontal-tangent cubic bezier from the source's side edge to the target's side edge. */
function edgeCurve(a: ReturnType<typeof frameBox>, b: ReturnType<typeof frameBox>): { d: string; ex: number; ey: number; dir: 1 | -1 } {
  const acy = a.y + a.h / 2;
  const bcy = b.y + b.h / 2;
  const rightward = b.x + b.w / 2 >= a.x + a.w / 2;
  const sx = rightward ? a.x + a.w : a.x;
  const ex = rightward ? b.x : b.x + b.w;
  const dir: 1 | -1 = rightward ? 1 : -1;
  const dx = Math.max(60, Math.abs(ex - sx) * 0.35) * dir;
  return { d: `M ${sx} ${acy} C ${sx + dx} ${acy}, ${ex - dx} ${bcy}, ${ex} ${bcy}`, ex, ey: bcy, dir };
}

export function DesignCanvasPanel({
  frames,
  setFrames,
  artifactCandidates,
  onAddPath,
  onPickLocalFiles,
  onPickImageFiles,
  onAddFrameToChat,
}: Props) {
  const { t } = useTranslation("workspace");
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CanvasView>({ zoom: 1, x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  /** Trae「预览 ⌥1」对标：开启后画框内页面可真实交互，关闭回到画板拖拽态。 */
  const [previewMode, setPreviewMode] = useState(false);
  /** Trae「连线 ⌥2」对标：页面跳转流向连线的显示开关（默认显示）。 */
  const [edgesVisible, setEdgesVisible] = useState(true);
  /** Trae「可视化编辑器 ⌥3」对标：画框内元素点选 + 右侧设计面板实时改样式。 */
  const [editorMode, setEditorMode] = useState(false);
  /** Currently selected element (frame + cssPath + reported styles). */
  const [selection, setSelection] = useState<{ frameId: string; payload: CanvasEditorSelectPayload } | null>(null);
  /** Unsaved edits: frameId -> cssPath -> form values. */
  const [editsByFrame, setEditsByFrame] = useState<Record<string, Record<string, CanvasStyleEdits>>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;
  const editorModeRef = useRef(editorMode);
  editorModeRef.current = editorMode;
  const [addOpen, setAddOpen] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{ left: number; top: number } | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  /** Trae「…」溢出菜单：导入图片素材 / 整理画布。 */
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState<{ left: number; top: number } | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  /** Trae「导出」对标：选中画框导出 PNG/JPG 多倍图，或全部源文件打包 Design ZIP。 */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportMenuPos, setExportMenuPos] = useState<{ left: number; top: number } | null>(null);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportScaleFor, setExportScaleFor] = useState<"png" | "jpeg" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  /** 整理画布时的一次性位移动画开关（拖拽时不挂 transition，避免跟手延迟）。 */
  const [layoutAnim, setLayoutAnim] = useState(false);
  const [srcDocById, setSrcDocById] = useState<Record<string, string>>({});
  /** Image frames: loaded data URL + natural (capped) display box. */
  const [imgSrcById, setImgSrcById] = useState<Record<string, string>>({});
  const [imgSizeById, setImgSizeById] = useState<Record<string, { width: number; height: number }>>({});
  /** Last observed file mtime per frame — drives auto-refresh polling. */
  const mtimeRef = useRef<Map<string, number>>(new Map());

  // ---- Per-frame selection chrome (Trae green floating bar + frame menu) ----
  const frameElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const floatingBarRef = useRef<HTMLDivElement>(null);
  const [frameMenuOpen, setFrameMenuOpen] = useState(false);
  const [frameMenuPos, setFrameMenuPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const frameMoreBtnRef = useRef<HTMLButtonElement>(null);
  const [frameSub, setFrameSub] = useState<"export" | "device" | null>(null);
  const [frameSubPos, setFrameSubPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [frameScaleFor, setFrameScaleFor] = useState<"png" | "jpeg" | null>(null);
  const [frameScalePos, setFrameScalePos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const frameSubHideTimer = useRef<number>(0);
  /** Inline rename in the frame header. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameCancelledRef = useRef(false);
  /**「添加到对话」transient pill feedback. */
  const [addToChatState, setAddToChatState] = useState<"idle" | "adding" | "added" | "error">("idle");
  const addToChatTimerRef = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(addToChatTimerRef.current), []);
  // Latest values for the window keydown handler (avoids rebinding on every toggle).
  const renamingIdRef = useRef<string | null>(null);
  renamingIdRef.current = renamingId;
  const frameMenuOpenRef = useRef(false);
  frameMenuOpenRef.current = frameMenuOpen;
  const frameSubRef = useRef<"export" | "device" | null>(null);
  frameSubRef.current = frameSub;

  const frameSyncKey = frames.map((f) => `${f.id}:${f.reloadNonce}`).join("|");

  // Load each frame's HTML from disk (relative assets inlined) on mount / refresh;
  // image frames load their data URL + natural box instead of a srcDoc.
  useEffect(() => {
    let cancelled = false;
    async function syncFrame(frame: CanvasFrame) {
      const result = await loadPreparedHtmlSrcDoc(frame.absolutePath);
      if (cancelled) return;
      if (result.ok) {
        setSrcDocById((prev) => (prev[frame.id] === result.srcDoc ? prev : { ...prev, [frame.id]: result.srcDoc }));
      }
      const stat = await window.agenticxDesktop?.statLocalPath?.(frame.absolutePath);
      if (!cancelled && stat?.ok && typeof stat.mtimeMs === "number") {
        mtimeRef.current.set(frame.id, stat.mtimeMs);
      }
    }
    async function syncImageFrame(frame: CanvasFrame) {
      const result = await window.agenticxDesktop?.loadLocalImageDataUrl?.(frame.absolutePath);
      if (cancelled) return;
      const dataUrl = result?.ok && typeof result.dataUrl === "string" ? result.dataUrl : "";
      setImgSrcById((prev) => (prev[frame.id] === dataUrl ? prev : { ...prev, [frame.id]: dataUrl }));
      if (dataUrl) {
        const probe = new Image();
        probe.onload = () => {
          if (cancelled) return;
          const box = fitImageBox(probe.naturalWidth, probe.naturalHeight);
          setImgSizeById((prev) => {
            const cur = prev[frame.id];
            if (cur && cur.width === box.width && cur.height === box.height) return prev;
            return { ...prev, [frame.id]: box };
          });
        };
        probe.src = dataUrl;
      } else {
        setImgSizeById((prev) => (frame.id in prev ? { ...prev, [frame.id]: IMAGE_FALLBACK_BOX } : prev));
      }
      const stat = await window.agenticxDesktop?.statLocalPath?.(frame.absolutePath);
      if (!cancelled && stat?.ok && typeof stat.mtimeMs === "number") {
        mtimeRef.current.set(frame.id, stat.mtimeMs);
      }
    }
    for (const frame of frames) {
      if (frame.kind === "image") void syncImageFrame(frame);
      else void syncFrame(frame);
    }
    // Drop cached srcDocs / image data for frames that no longer exist.
    const liveIds = new Set(frames.map((f) => f.id));
    setSrcDocById((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [id, doc] of Object.entries(prev)) {
        if (liveIds.has(id)) next[id] = doc;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setImgSrcById((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [id, src] of Object.entries(prev)) {
        if (liveIds.has(id)) next[id] = src;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setImgSizeById((prev) => {
      const next: Record<string, { width: number; height: number }> = {};
      let changed = false;
      for (const [id, box] of Object.entries(prev)) {
        if (liveIds.has(id)) next[id] = box;
        else changed = true;
      }
      return changed ? next : prev;
    });
    // Disk-watch: re-bump frames whose file changed.
    const timer = window.setInterval(() => {
      for (const frame of frames) {
        void window.agenticxDesktop
          ?.statLocalPath?.(frame.absolutePath)
          .then((stat) => {
            if (cancelled || !stat?.ok || typeof stat.mtimeMs !== "number") return;
            const known = mtimeRef.current.get(frame.id);
            if (known !== undefined && stat.mtimeMs !== known) {
              mtimeRef.current.set(frame.id, stat.mtimeMs);
              setFrames((prev) =>
                prev.map((item) =>
                  item.id === frame.id ? { ...item, reloadNonce: item.reloadNonce + 1 } : item,
                ),
              );
            }
          })
          .catch(() => undefined);
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSyncKey]);

  const panState = useRef<{ pointerId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const dragState = useRef<{ pointerId: number; frameId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const htmlCandidates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const path of artifactCandidates) {
      if (!isInAppHtmlPreviewPath(path)) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
    return out;
  }, [artifactCandidates]);

  const framePathSet = useMemo(() => new Set(frames.map((f) => f.absolutePath)), [frames]);
  const selectedFrame = frames.find((f) => f.id === selectedId) ?? null;
  const selectedBox = selectedFrame ? frameBox(selectedFrame, imgSizeById[selectedFrame.id]) : null;
  const edges = useMemo(() => deriveEdges(frames, srcDocById), [frames, srcDocById]);

  const fitRect = useCallback(
    (rect: { minX: number; minY: number; maxX: number; maxY: number }) => {
      const el = viewportRef.current;
      if (!el) return;
      const pad = 72;
      const width = Math.max(1, rect.maxX - rect.minX);
      const height = Math.max(1, rect.maxY - rect.minY);
      const zoom = clampZoom(
        Math.min((el.clientWidth - pad * 2) / width, (el.clientHeight - pad * 2) / height),
      );
      setView({
        zoom,
        x: (el.clientWidth - width * zoom) / 2 - rect.minX * zoom,
        y: (el.clientHeight - height * zoom) / 2 - rect.minY * zoom,
      });
    },
    [],
  );

  const fitAll = useCallback(
    (targets?: CanvasFrame[]) => {
      const list = targets && targets.length > 0 ? targets : frames;
      if (list.length === 0) {
        setView({ zoom: 1, x: 0, y: 0 });
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const frame of list) {
        const box = frameBox(frame, imgSizeById[frame.id]);
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.w);
        maxY = Math.max(maxY, box.y + box.h);
      }
      fitRect({ minX, minY, maxX, maxY });
    },
    [frames, fitRect, imgSizeById],
  );
  /** Latest fitAll in a ref — deferred callers (organize animation) see fresh frames. */
  const fitAllRef = useRef(fitAll);
  fitAllRef.current = fitAll;

  // Auto-fit when the first frame lands on an empty canvas.
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (prevCountRef.current === 0 && frames.length > 0) {
      fitAll();
    }
    prevCountRef.current = frames.length;
  }, [frames.length, fitAll]);

  // Drop selection when its frame disappears; tear down its chrome too.
  useEffect(() => {
    if (selectedId && !frames.some((f) => f.id === selectedId)) {
      setSelectedId(null);
    }
  }, [frames, selectedId]);

  useEffect(() => {
    if (selectedId) return;
    setFrameMenuOpen(false);
    setFrameMenuPos(null);
    setFrameSub(null);
    setFrameSubPos(null);
    setFrameScaleFor(null);
    setFrameScalePos(null);
    setRenamingId((cur) => {
      if (cur) renameCancelledRef.current = true;
      return null;
    });
  }, [selectedId]);

  // Frame menu is screen-anchored: drop it as soon as the canvas moves.
  const viewSnapshot = `${view.x}|${view.y}|${view.zoom}`;
  const firstViewRef = useRef(true);
  useEffect(() => {
    if (firstViewRef.current) {
      firstViewRef.current = false;
      return;
    }
    setFrameMenuOpen(false);
    setFrameMenuPos(null);
    setFrameSub(null);
    setFrameSubPos(null);
    setFrameScaleFor(null);
    setFrameScalePos(null);
  }, [viewSnapshot]);

  // Non-passive wheel: ctrl/cmd+wheel (incl. trackpad pinch) zooms, rest pans.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.012);
        setView((v) => zoomAt(v, v.zoom * factor, cx, cy));
        return;
      }
      const lineScale = event.deltaMode === 1 ? 16 : 1;
      setView((v) => ({ ...v, x: v.x - event.deltaX * lineScale, y: v.y - event.deltaY * lineScale }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** 预览与可视化编辑互斥（对标 Trae：编辑器打开即进入元素点选态）。 */
  const togglePreviewMode = useCallback(() => {
    const next = !previewModeRef.current;
    setPreviewMode(next);
    if (next && editorModeRef.current) setEditorMode(false);
  }, []);
  const toggleEditorMode = useCallback(() => {
    const next = !editorModeRef.current;
    setEditorMode(next);
    if (next && previewModeRef.current) setPreviewMode(false);
  }, []);

  // Space-bar panning affordance.
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape" && !event.repeat) {
        if (renamingIdRef.current) {
          renameCancelledRef.current = true;
          setRenamingId(null);
          return;
        }
        if (frameMenuOpenRef.current || frameSubRef.current) {
          setFrameMenuOpen(false);
          setFrameMenuPos(null);
          setFrameSub(null);
          setFrameSubPos(null);
          setFrameScaleFor(null);
          setFrameScalePos(null);
          return;
        }
        setSelectedId(null);
        return;
      }
      if (event.code === "Space" && !event.repeat && !isTypingTarget(event.target)) {
        setSpaceDown(true);
      }
      // ⌥/Alt + 1 toggles preview mode (same affordance as Trae's canvas).
      if (event.altKey && event.code === "Digit1" && !event.repeat && !isTypingTarget(event.target)) {
        event.preventDefault();
        togglePreviewMode();
      }
      // ⌥/Alt + 2 toggles page-flow edges.
      if (event.altKey && event.code === "Digit2" && !event.repeat && !isTypingTarget(event.target)) {
        event.preventDefault();
        setEdgesVisible((v) => !v);
      }
      // ⌥/Alt + 3 toggles the visual editor.
      if (event.altKey && event.code === "Digit3" && !event.repeat && !isTypingTarget(event.target)) {
        event.preventDefault();
        toggleEditorMode();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [togglePreviewMode, toggleEditorMode]);

  // Leaving editor mode drops the element selection (overlays hide via bridge).
  useEffect(() => {
    if (!editorMode) setSelection(null);
  }, [editorMode]);

  // Save status auto-clears.
  useEffect(() => {
    if (saveState !== "saved" && saveState !== "failed") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 2400);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  // Unified window-level drag handling (canvas pan + frame move).
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const pan = panState.current;
      if (pan && pan.pointerId === event.pointerId) {
        setView((v) => ({
          ...v,
          x: pan.origX + (event.clientX - pan.startX),
          y: pan.origY + (event.clientY - pan.startY),
        }));
        return;
      }
      const drag = dragState.current;
      if (drag && drag.pointerId === event.pointerId) {
        setFrames((prev) =>
          prev.map((frame) => {
            if (frame.id !== drag.frameId) return frame;
            return {
              ...frame,
              x: Math.round(drag.origX + (event.clientX - drag.startX) / view.zoom),
              y: Math.round(drag.origY + (event.clientY - drag.startY) / view.zoom),
            };
          }),
        );
      }
    };
    const onUp = (event: PointerEvent) => {
      if (panState.current?.pointerId === event.pointerId) panState.current = null;
      if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setFrames, view.zoom]);

  // Live reload frames when their on-disk HTML changes.
  useEffect(() => {
    if (frames.length === 0) return;
    const stat = window.agenticxDesktop?.statLocalPath;
    if (typeof stat !== "function") return;
    const knownMtimes = new Map<string, number>();
    let cancelled = false;
    const tick = async () => {
      for (const frame of frames) {
        try {
          const result = await stat(frame.absolutePath);
          if (cancelled) return;
          if (!result.ok || typeof result.mtimeMs !== "number") continue;
          const prev = knownMtimes.get(frame.absolutePath);
          knownMtimes.set(frame.absolutePath, result.mtimeMs);
          if (prev != null && prev !== result.mtimeMs) {
            const frameId = frame.id;
            setFrames((prevFrames) =>
              prevFrames.map((item) =>
                item.id === frameId ? { ...item, reloadNonce: item.reloadNonce + 1 } : item,
              ),
            );
          }
        } catch {
          // stat failures (file moved / deleted) are non-fatal; iframe keeps last render.
        }
      }
    };
    const timer = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [frames, setFrames]);

  const beginCanvasPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Middle mouse, space-drag, or left drag starting on empty canvas.
    const onBackground = Boolean((event.target as HTMLElement).closest("[data-canvas-bg]"));
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && !spaceDown && !onBackground) return;
    // Clicking empty canvas clears the element + frame selection (Trae parity).
    if (editorModeRef.current) setSelection(null);
    setSelectedId(null);
    event.preventDefault();
    panState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: view.x,
      origY: view.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const beginFrameDrag = (event: ReactPointerEvent<HTMLDivElement>, frame: CanvasFrame) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setSelectedId(frame.id);
    dragState.current = {
      pointerId: event.pointerId,
      frameId: frame.id,
      startX: event.clientX,
      startY: event.clientY,
      origX: frame.x,
      origY: frame.y,
    };
  };

  const bumpFrame = (frameId: string, patch: Partial<Pick<CanvasFrame, "device" | "reloadNonce">>) => {
    setFrames((prev) => prev.map((frame) => (frame.id === frameId ? { ...frame, ...patch } : frame)));
  };

  const closeFrame = (frameId: string) => {
    setFrames((prev) => prev.filter((frame) => frame.id !== frameId));
    setEditsByFrame((prev) => {
      if (!prev[frameId]) return prev;
      const next = { ...prev };
      delete next[frameId];
      return next;
    });
    setSelection((prev) => (prev && prev.frameId === frameId ? null : prev));
    if (selectedId === frameId) setSelectedId(null);
  };

  // ---- Per-frame chrome actions (Trae green floating bar / frame menu) ----

  const closeFrameMenu = useCallback(() => {
    setFrameMenuOpen(false);
    setFrameMenuPos(null);
    setFrameSub(null);
    setFrameSubPos(null);
    setFrameScaleFor(null);
    setFrameScalePos(null);
  }, []);

  /** Frame menu stays screen-anchored, so any outside mousedown dismisses it. */
  useEffect(() => {
    if (!frameMenuOpen) return;
    const onDocPointer = () => closeFrameMenu();
    window.addEventListener("mousedown", onDocPointer);
    return () => window.removeEventListener("mousedown", onDocPointer);
  }, [frameMenuOpen, closeFrameMenu]);

  const duplicateFrame = (frame: CanvasFrame) => {
    const newId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dot = frame.title.lastIndexOf(".");
    const base = dot > 0 ? frame.title.slice(0, dot) : frame.title;
    const ext = dot > 0 ? frame.title.slice(dot) : "";
    const copy: CanvasFrame = {
      ...frame,
      id: newId,
      title: `${base} ${t("work.canvas.frameCopySuffix")}${ext}`,
      x: frame.x + 40,
      y: frame.y + 40,
      reloadNonce: 0,
    };
    setFrames((prev) => [...prev, copy]);
    setSelectedId(newId);
  };

  const startRename = (frame: CanvasFrame) => {
    renameCancelledRef.current = false;
    setRenameDraft(frame.title);
    setRenamingId(frame.id);
  };

  const commitRename = () => {
    const id = renamingIdRef.current;
    if (!id) return;
    const next = renameDraft.trim();
    if (next && !renameCancelledRef.current) {
      setFrames((prev) => prev.map((frame) => (frame.id === id ? { ...frame, title: next } : frame)));
    }
    setRenamingId(null);
  };

  const openFrameMenu = () => {
    if (frameMenuOpen) {
      closeFrameMenu();
      return;
    }
    const rect = frameMoreBtnRef.current?.getBoundingClientRect();
    if (!rect || !selectedFrame) return;
    // Menus are mutually exclusive with the top-toolbar menus.
    setAddOpen(false);
    setMoreOpen(false);
    setExportOpen(false);
    setExportScaleFor(null);
    const MENU_W = 208;
    const left = Math.min(Math.max(8, rect.right - MENU_W), window.innerWidth - MENU_W - 8);
    const pos =
      rect.top > 360
        ? { left, bottom: window.innerHeight - rect.top + 6 }
        : { left, top: rect.bottom + 6 };
    setFrameMenuPos(pos);
    setFrameSub(null);
    setFrameSubPos(null);
    setFrameScaleFor(null);
    setFrameScalePos(null);
    setFrameMenuOpen(true);
  };

  const showFrameSub = (kind: "export" | "device", rowRect: DOMRect) => {
    window.clearTimeout(frameSubHideTimer.current);
    setFrameSubPos({
      left: rowRect.right - 4,
      ...(frameMenuPos?.bottom !== undefined
        ? { bottom: window.innerHeight - rowRect.top }
        : { top: rowRect.top }),
    });
    setFrameSub(kind);
    setFrameScaleFor(null);
  };

  const scheduleHideFrameSub = () => {
    window.clearTimeout(frameSubHideTimer.current);
    frameSubHideTimer.current = window.setTimeout(() => {
      setFrameSub(null);
      setFrameScaleFor(null);
    }, 220);
  };

  const showFrameScale = (format: "png" | "jpeg", rowRect: DOMRect) => {
    window.clearTimeout(frameSubHideTimer.current);
    setFrameScalePos({
      left: rowRect.right - 4,
      ...(frameMenuPos?.bottom !== undefined
        ? { bottom: window.innerHeight - rowRect.top }
        : { top: rowRect.top }),
    });
    setFrameScaleFor(format);
  };

  const handleAddFrameToChat = async (frame: CanvasFrame) => {
    if (!onAddFrameToChat || addToChatState === "adding") return;
    setAddToChatState("adding");
    let ok: boolean | void = true;
    try {
      ok = await onAddFrameToChat(frame);
    } catch {
      ok = false;
    }
    setAddToChatState(ok === false ? "error" : "added");
    window.clearTimeout(addToChatTimerRef.current);
    addToChatTimerRef.current = window.setTimeout(() => setAddToChatState("idle"), 1400);
  };

  // rAF follow: the floating green bar tracks the frame's live screen rect
  // (survives pan / zoom / drag / the 320ms organize animation without re-render churn).
  useEffect(() => {
    if (!selectedId) return;
    let raf = 0;
    const tick = () => {
      const bar = floatingBarRef.current;
      const el = frameElsRef.current.get(selectedId);
      if (bar && el) {
        const rect = el.getBoundingClientRect();
        const visible = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
        if (!visible) {
          bar.style.opacity = "0";
          bar.style.pointerEvents = "none";
        } else {
          bar.style.opacity = "1";
          bar.style.pointerEvents = "auto";
          const cx = rect.left + rect.width / 2;
          const y = rect.top > 52 ? rect.top - 40 : rect.top + 8;
          bar.style.transform = `translate3d(${cx}px, ${y}px, 0) translate(-50%, 0)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

  /** Edits composed into concrete CSS props per frame (fed to the bridges). */
  const styleMapsByFrame = useMemo(() => {
    const out: Record<string, CanvasEditorStyleMap> = {};
    for (const [frameId, byPath] of Object.entries(editsByFrame)) {
      const map: CanvasEditorStyleMap = {};
      for (const [cssPath, edits] of Object.entries(byPath)) {
        const composed = composeEditorStyle(edits);
        if (Object.keys(composed).length > 0) map[cssPath] = composed;
      }
      if (Object.keys(map).length > 0) out[frameId] = map;
    }
    return out;
  }, [editsByFrame]);

  const hasUnsavedEdits = Object.keys(styleMapsByFrame).length > 0;

  const handleEditorSelect = (frameId: string, payload: CanvasEditorSelectPayload | null) => {
    if (!payload) {
      setSelection(null);
      return;
    }
    // ⌘/Ctrl + Click quick-select opens the editor panel (Trae parity).
    if (payload.quick && !editorModeRef.current) {
      setEditorMode(true);
      if (previewModeRef.current) setPreviewMode(false);
    }
    setSelection({ frameId, payload });
  };

  const applyEdit = (key: keyof CanvasStyleEdits, value: string | undefined) => {
    const sel = selection;
    if (!sel) return;
    setEditsByFrame((prev) => {
      const next = { ...prev };
      const frameMap = { ...(next[sel.frameId] ?? {}) };
      const current = { ...(frameMap[sel.payload.cssPath] ?? {}) };
      if (value === undefined || value === "") delete current[key];
      else current[key] = value;
      if (Object.keys(current).length > 0) frameMap[sel.payload.cssPath] = current;
      else delete frameMap[sel.payload.cssPath];
      if (Object.keys(frameMap).length > 0) next[sel.frameId] = frameMap;
      else delete next[sel.frameId];
      return next;
    });
    setSaveState("idle");
  };

  const resetElementEdits = () => {
    const sel = selection;
    if (!sel) return;
    setEditsByFrame((prev) => {
      if (!prev[sel.frameId]?.[sel.payload.cssPath]) return prev;
      const next = { ...prev };
      const frameMap = { ...next[sel.frameId] };
      delete frameMap[sel.payload.cssPath];
      if (Object.keys(frameMap).length > 0) next[sel.frameId] = frameMap;
      else delete next[sel.frameId];
      return next;
    });
    setSaveState("idle");
  };

  /** Write all pending edits back into the source HTML files, then refresh. */
  const saveEdits = async () => {
    const api = window.agenticxDesktop;
    if (!api?.readLocalTextFile || !api?.writeLocalTextFile || !hasUnsavedEdits) return;
    setSaveState("saving");
    try {
      for (const frame of frames) {
        const styleMap = styleMapsByFrame[frame.id];
        if (!styleMap) continue;
        const read = (await api.readLocalTextFile(frame.absolutePath)) as {
          ok?: boolean;
          content?: string;
        };
        if (!read?.ok || typeof read.content !== "string") throw new Error("read failed");
        const nextHtml = applyEditsToHtmlSource(read.content, styleMap);
        const write = await api.writeLocalTextFile({ path: frame.absolutePath, content: nextHtml });
        if (!write?.ok) throw new Error(write?.error || "write failed");
        if (typeof write.mtimeMs === "number") mtimeRef.current.set(frame.id, write.mtimeMs);
        setEditsByFrame((prev) => {
          if (!prev[frame.id]) return prev;
          const next = { ...prev };
          delete next[frame.id];
          return next;
        });
        // Immediate refresh; the mtime watcher sees the fresh mtime and stays quiet.
        setFrames((prev) =>
          prev.map((item) =>
            item.id === frame.id ? { ...item, reloadNonce: item.reloadNonce + 1 } : item,
          ),
        );
      }
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  };

  const zoomStep = (direction: 1 | -1) => {
    const el = viewportRef.current;
    if (!el) return;
    setView((v) =>
      zoomAt(v, v.zoom * (direction > 0 ? 1.2 : 1 / 1.2), el.clientWidth / 2, el.clientHeight / 2),
    );
  };

  const openAddMenu = () => {
    const rect = addBtnRef.current?.getBoundingClientRect();
    closeFrameMenu();
    setAddMenuPos(rect ? { left: rect.left, top: rect.bottom + 6 } : { left: 16, top: 52 });
    setAddOpen(true);
  };

  const openMoreMenu = () => {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    closeFrameMenu();
    // Right-align the menu under the「…」button.
    setMoreMenuPos(rect ? { left: Math.max(8, rect.right - 208), top: rect.bottom + 6 } : { left: 16, top: 52 });
    setMoreOpen(true);
  };

  const openExportMenu = () => {
    const rect = exportBtnRef.current?.getBoundingClientRect();
    closeFrameMenu();
    setExportMenuPos(rect ? { left: Math.max(8, rect.right - 208), top: rect.bottom + 6 } : { left: 16, top: 52 });
    setExportScaleFor(null);
    setExportOpen(true);
  };

  /** Trae「整理画布」对标：所有画框按近似方阵网格重排并适应视图。 */
  const organizeCanvas = useCallback(() => {
    setFrames((prev) => {
      if (prev.length === 0) return prev;
      const cols = Math.ceil(Math.sqrt(prev.length));
      const GAP_X = 120;
      const GAP_Y = 120;
      const ORIGIN = 80;
      let x = ORIGIN;
      let y = ORIGIN;
      let rowH = 0;
      return prev.map((frame, index) => {
        const box = frameBox(frame, imgSizeById[frame.id]);
        const placed = { ...frame, x, y };
        rowH = Math.max(rowH, box.h);
        x += box.w + GAP_X;
        if ((index + 1) % cols === 0) {
          x = ORIGIN;
          y += rowH + GAP_Y;
          rowH = 0;
        }
        return placed;
      });
    });
    setLayoutAnim(true);
    window.setTimeout(() => setLayoutAnim(false), 380);
    // Fit after the re-layout commit (fitAllRef always sees the latest frames).
    window.setTimeout(() => fitAllRef.current(), 60);
  }, [setFrames, imgSizeById]);

  const exportFrameImage = useCallback(
    (format: "png" | "jpeg", scale: number) => {
      const frame = selectedFrame;
      const api = window.agenticxDesktop?.exportCanvasFrameImage;
      if (!frame || !api || exporting) return;
      const box = frameBox(frame, imgSizeById[frame.id]);
      let html = "";
      if (frame.kind === "image") {
        const dataUrl = imgSrcById[frame.id];
        if (!dataUrl) return;
        html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;}img{display:block;}</style></head><body><img src="${dataUrl}" width="${box.w}" height="${box.h - FRAME_HEADER_H}" alt=""></body></html>`;
      } else {
        html = srcDocById[frame.id] ?? "";
        if (!html) return;
      }
      setExporting(true);
      setExportFailed(false);
      void (async () => {
        try {
          const result = await api({
            html,
            width: box.w,
            height: box.h - FRAME_HEADER_H,
            format,
            scale,
            baseName: frame.title.replace(/\.[^.]+$/, "") || "canvas-frame",
          });
          if (!result?.ok && !result?.canceled) setExportFailed(true);
        } catch {
          setExportFailed(true);
        } finally {
          setExporting(false);
        }
      })();
    },
    [selectedFrame, exporting, imgSizeById, imgSrcById, srcDocById],
  );

  const exportDesignZip = useCallback(() => {
    const api = window.agenticxDesktop?.exportCanvasZip;
    if (!api || frames.length === 0 || exporting) return;
    setExporting(true);
    setExportFailed(false);
    void (async () => {
      try {
        const result = await api({
          files: frames.map((frame) => ({ path: frame.absolutePath })),
          baseName: "design",
        });
        if (!result?.ok && !result?.canceled) setExportFailed(true);
      } catch {
        setExportFailed(true);
      } finally {
        setExporting(false);
      }
    })();
  }, [frames, exporting]);

  // Export-failure pill auto-clears.
  useEffect(() => {
    if (!exportFailed) return;
    const timer = window.setTimeout(() => setExportFailed(false), 2600);
    return () => window.clearTimeout(timer);
  }, [exportFailed]);

  useEffect(() => {
    if (!addOpen) return;
    const onDocPointer = () => setAddOpen(false);
    window.addEventListener("mousedown", onDocPointer);
    return () => window.removeEventListener("mousedown", onDocPointer);
  }, [addOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDocPointer = () => setMoreOpen(false);
    window.addEventListener("mousedown", onDocPointer);
    return () => window.removeEventListener("mousedown", onDocPointer);
  }, [moreOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDocPointer = () => setExportOpen(false);
    window.addEventListener("mousedown", onDocPointer);
    return () => window.removeEventListener("mousedown", onDocPointer);
  }, [exportOpen]);

  const addMenu =
    addOpen && addMenuPos
      ? createPortal(
          <div
            className="fixed z-[130] w-[280px] overflow-hidden rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
            style={{ left: addMenuPos.left, top: addMenuPos.top }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-text-faint">
              {t("work.canvas.addArtifact")}
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {htmlCandidates.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-text-faint">{t("work.canvas.noArtifacts")}</div>
              ) : (
                htmlCandidates.map((path) => {
                  const added = framePathSet.has(path);
                  return (
                    <button
                      key={path}
                      type="button"
                      disabled={added}
                      title={path}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] enabled:hover:bg-surface-hover disabled:cursor-default"
                      onClick={() => {
                        onAddPath(path);
                        setAddOpen(false);
                      }}
                    >
                      <FrameIcon className="h-3.5 w-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
                      <span className={`min-w-0 flex-1 truncate ${added ? "text-text-faint" : "text-text-strong"}`}>
                        {artifactBaseName(path)}
                      </span>
                      {added ? (
                        <span className="shrink-0 text-[10.5px] text-text-faint">
                          {t("work.canvas.frameAlreadyAdded")}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-strong hover:bg-surface-hover"
              onClick={() => {
                onPickLocalFiles();
                setAddOpen(false);
              }}
            >
              <FolderOpen className="h-3.5 w-3.5 text-text-subtle" strokeWidth={1.7} />
              {t("work.canvas.pickFile")}
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-strong hover:bg-surface-hover"
              onClick={() => {
                onPickImageFiles();
                setAddOpen(false);
              }}
            >
              <Upload className="h-3.5 w-3.5 text-text-subtle" strokeWidth={1.7} />
              {t("work.canvas.importImages")}
            </button>
          </div>,
          document.body,
        )
      : null;

  const menuItemCls =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-strong hover:bg-surface-hover disabled:cursor-default disabled:text-text-faint disabled:hover:bg-transparent";
  const menuIconCls = "h-3.5 w-3.5 text-text-subtle";

  /** Hover-submenu grace: leaving the row hides the submenu after a delay,
   *  canceled when the pointer lands inside the submenu itself. */
  const scaleHideTimer = useRef<number>(0);
  const showScaleMenu = (format: "png" | "jpeg") => {
    window.clearTimeout(scaleHideTimer.current);
    setExportScaleFor(format);
  };
  const scheduleHideScaleMenu = () => {
    window.clearTimeout(scaleHideTimer.current);
    scaleHideTimer.current = window.setTimeout(() => setExportScaleFor(null), 220);
  };
  useEffect(() => () => window.clearTimeout(scaleHideTimer.current), []);

  const moreMenu =
    moreOpen && moreMenuPos
      ? createPortal(
          <div
            className="fixed z-[130] w-[208px] overflow-hidden rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
            style={{ left: moreMenuPos.left, top: moreMenuPos.top }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={menuItemCls}
              onClick={() => {
                onPickImageFiles();
                setMoreOpen(false);
              }}
            >
              <Upload className={menuIconCls} strokeWidth={1.7} />
              {t("work.canvas.importImages")}
            </button>
            <button
              type="button"
              disabled={frames.length === 0}
              className={menuItemCls}
              onClick={() => {
                organizeCanvas();
                setMoreOpen(false);
              }}
            >
              <LayoutGrid className={menuIconCls} strokeWidth={1.7} />
              {t("work.canvas.organize")}
            </button>
          </div>,
          document.body,
        )
      : null;

  const scaleSubMenu = (format: "png" | "jpeg") =>
    exportScaleFor === format
      ? createPortal(
          <div
            className="fixed z-[131] w-[96px] overflow-hidden rounded-xl border border-border bg-surface-popover py-1 shadow-xl"
            style={{
              left: (exportMenuPos?.left ?? 0) + 208 - 4,
              top: (exportMenuPos?.top ?? 0) + 6 + (format === "png" ? 0 : 34),
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseEnter={() => showScaleMenu(format)}
            onMouseLeave={scheduleHideScaleMenu}
          >
            {([1, 2, 3] as const).map((scale) => (
              <button
                key={scale}
                type="button"
                className={menuItemCls}
                onClick={() => {
                  window.clearTimeout(scaleHideTimer.current);
                  setExportScaleFor(null);
                  setExportOpen(false);
                  exportFrameImage(format, scale);
                }}
              >
                {scale}X
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  const exportMenu =
    exportOpen && exportMenuPos
      ? createPortal(
          <div
            className="fixed z-[130] w-[208px] overflow-hidden rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
            style={{ left: exportMenuPos.left, top: exportMenuPos.top }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {(["png", "jpeg"] as const).map((format) => (
              <button
                key={format}
                type="button"
                disabled={!selectedFrame || exporting}
                title={selectedFrame ? undefined : t("work.canvas.selectFrameHint")}
                className={`${menuItemCls} justify-between`}
                onMouseEnter={() => showScaleMenu(format)}
                onMouseLeave={scheduleHideScaleMenu}
                onClick={() => {
                  if (!selectedFrame || exporting) return;
                  window.clearTimeout(scaleHideTimer.current);
                  setExportScaleFor(null);
                  setExportOpen(false);
                  exportFrameImage(format, 1);
                }}
              >
                <span className="flex items-center gap-2">
                  <ImageIcon className={menuIconCls} strokeWidth={1.7} />
                  {format === "png" ? "PNG" : "JPG"}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.7} />
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              disabled={frames.length === 0 || exporting}
              className={menuItemCls}
              onMouseEnter={() => {
                window.clearTimeout(scaleHideTimer.current);
                setExportScaleFor(null);
              }}
              onClick={() => {
                setExportOpen(false);
                exportDesignZip();
              }}
            >
              <FileArchive className={menuIconCls} strokeWidth={1.7} />
              Design ZIP
            </button>
          </div>,
          document.body,
        )
      : null;

  const toolBtn =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";

  // ---- Visual editor panel derived values ----
  const selEdits: CanvasStyleEdits = selection
    ? (editsByFrame[selection.frameId]?.[selection.payload.cssPath] ?? {})
    : {};
  const selComputed = selection?.payload.computed ?? {};
  const selTransform = parseMatrixTransform(selComputed.transform);
  const selValue = {
    flexDirection: selEdits.flexDirection ?? selComputed.flexDirection ?? "",
    marginTop: selEdits.marginTop ?? parsePx(selComputed.marginTop),
    marginRight: selEdits.marginRight ?? parsePx(selComputed.marginRight),
    marginBottom: selEdits.marginBottom ?? parsePx(selComputed.marginBottom),
    marginLeft: selEdits.marginLeft ?? parsePx(selComputed.marginLeft),
    paddingTop: selEdits.paddingTop ?? parsePx(selComputed.paddingTop),
    paddingRight: selEdits.paddingRight ?? parsePx(selComputed.paddingRight),
    paddingBottom: selEdits.paddingBottom ?? parsePx(selComputed.paddingBottom),
    paddingLeft: selEdits.paddingLeft ?? parsePx(selComputed.paddingLeft),
    gap: selEdits.gap ?? parsePx(selComputed.gap),
    opacity:
      selEdits.opacity ??
      (selComputed.opacity ? String(Math.round(parseFloat(selComputed.opacity) * 100)) : ""),
    borderRadius: selEdits.borderRadius ?? parsePx(selComputed.borderTopLeftRadius),
    translateX: selEdits.translateX ?? selTransform.x,
    translateY: selEdits.translateY ?? selTransform.y,
    rotate: selEdits.rotate ?? selTransform.rotate,
  };
  const editorInput =
    "h-7 w-full rounded-md border border-border bg-surface-card px-1 text-center text-[12px] tabular-nums text-text-strong outline-none focus:border-[var(--ui-btn-primary-bg,#3b82f6)]";
  const editorSectionTitle = "text-[11px] font-medium text-text-faint";
  const editorSideLabels = [
    t("work.canvas.editorSideTop"),
    t("work.canvas.editorSideRight"),
    t("work.canvas.editorSideBottom"),
    t("work.canvas.editorSideLeft"),
  ];
  const spacingField = (key: keyof CanvasStyleEdits & string, sideIdx: number) => (
    <label key={key} className="flex flex-col items-center gap-0.5">
      <input
        type="number"
        aria-label={editorSideLabels[sideIdx]}
        className={editorInput}
        value={selValue[key as keyof typeof selValue] ?? ""}
        onChange={(event) => applyEdit(key, event.target.value)}
      />
      <span className="text-[10px] text-text-faint">{editorSideLabels[sideIdx]}</span>
    </label>
  );

  const deviceToolBtn = (device: CanvasDevice, label: string, children: React.ReactNode) => (
    <HoverTip label={label}>
      <button
        type="button"
        disabled={!selectedFrame || selectedFrame.kind === "image"}
        aria-label={label}
        aria-pressed={selectedFrame?.device === device}
        className={`${toolBtn} ${
          selectedFrame?.device === device ? "bg-surface-hover text-text-strong" : ""
        }`}
        onClick={() => {
          if (!selectedFrame || selectedFrame.kind === "image") return;
          bumpFrame(selectedFrame.id, { device });
        }}
      >
        {children}
      </button>
    </HoverTip>
  );

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {/* Pannable / zoomable surface */}
      <div
        ref={viewportRef}
        data-canvas-bg="1"
        className={`absolute inset-0 ${spaceDown ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          backgroundColor: "color-mix(in oklab, var(--surface-hover) 55%, transparent)",
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--text-faint) 45%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={beginCanvasPan}
      >
        <div
          data-canvas-bg="1"
          className="absolute left-0 top-0"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}
        >
          {/* Page-flow edges (world coordinates — scale with zoom), under the frames. */}
          {edgesVisible && edges.length > 0 ? (
            <svg data-canvas-edges="1" className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
              {edges.map((edge) => {
                const from = frames.find((f) => f.id === edge.fromId);
                const to = frames.find((f) => f.id === edge.toId);
                if (!from || !to) return null;
                const curve = edgeCurve(frameBox(from), frameBox(to));
                const active = selectedId !== null && (selectedId === edge.fromId || selectedId === edge.toId);
                const color = active ? CANVAS_GREEN : "var(--text-faint,#9ca3af)";
                return (
                  <g key={`${edge.fromId}->${edge.toId}`}>
                    <path
                      d={curve.d}
                      fill="none"
                      stroke={color}
                      strokeWidth={active ? 2 : 1.5}
                      strokeDasharray={active ? undefined : "6 4"}
                      opacity={active ? 0.95 : 0.6}
                    />
                    <path
                      d={`M ${curve.ex} ${curve.ey} L ${curve.ex - curve.dir * 10} ${curve.ey - 5} L ${curve.ex - curve.dir * 10} ${curve.ey + 5} Z`}
                      fill={color}
                      opacity={active ? 0.95 : 0.6}
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}
          {frames.map((frame) => {
            const size = frameBodySize(frame, imgSizeById[frame.id]);
            const selected = frame.id === selectedId;
            const isImage = frame.kind === "image";
            const imgState = !isImage ? "ready" : !(frame.id in imgSrcById) ? "loading" : imgSrcById[frame.id] ? "ready" : "failed";
            return (
              <div
                key={frame.id}
                data-canvas-frame="1"
                ref={(el) => {
                  if (el) frameElsRef.current.set(frame.id, el);
                  else frameElsRef.current.delete(frame.id);
                }}
                className={`absolute flex flex-col overflow-hidden rounded-xl border bg-white shadow-md transition-shadow ${
                  // CANVAS_GREEN = #34c759; keep literal so Tailwind JIT emits the class.
                  selected ? "border-[#34c759] ring-2 ring-[#34c759]/35" : "border-border"
                }`}
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: size.width,
                  transition: layoutAnim ? "left 0.32s ease, top 0.32s ease, box-shadow 0.15s ease" : undefined,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setSelectedId(frame.id);
                }}
              >
                <div
                  className="flex h-9 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b border-border bg-surface-card px-2 active:cursor-grabbing"
                  onPointerDown={(event) => beginFrameDrag(event, frame)}
                >
                  {isImage ? (
                    <ImageIcon className={deviceIconClass} strokeWidth={1.7} />
                  ) : frame.device === "desktop" ? (
                    <Monitor className={deviceIconClass} strokeWidth={1.7} />
                  ) : frame.device === "tablet" ? (
                    <Tablet className={deviceIconClass} strokeWidth={1.7} />
                  ) : (
                    <Smartphone className={deviceIconClass} strokeWidth={1.7} />
                  )}
                  {renamingId === frame.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      aria-label={t("work.canvas.renameTitlePlaceholder")}
                      className="min-w-0 flex-1 rounded border border-[#34c759] bg-white px-1 py-0 text-[12px] font-medium text-text-strong outline-none ring-1 ring-[#34c759]/35"
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.code === "Enter") {
                          event.preventDefault();
                          commitRename();
                        } else if (event.code === "Escape") {
                          event.preventDefault();
                          renameCancelledRef.current = true;
                          setRenamingId(null);
                        }
                      }}
                      onBlur={() => commitRename()}
                    />
                  ) : (
                    <span
                      className="min-w-0 flex-1 cursor-grab truncate text-[12px] font-medium text-text-strong"
                      title={frame.title}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        startRename(frame);
                      }}
                    >
                      {frame.title}
                    </span>
                  )}
                  <HoverTip label={t("work.canvas.refreshFrame")}>
                    <button
                      type="button"
                      aria-label={t("work.canvas.refreshFrame")}
                      className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        bumpFrame(frame.id, { reloadNonce: frame.reloadNonce + 1 });
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </HoverTip>
                  <HoverTip label={t("work.canvas.openExternal")}>
                    <button
                      type="button"
                      aria-label={t("work.canvas.openExternal")}
                      className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        void window.agenticxDesktop?.shellOpenPath?.(frame.absolutePath);
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </button>
                  </HoverTip>
                  <HoverTip label={t("work.canvas.closeFrame")}>
                    <button
                      type="button"
                      aria-label={t("work.canvas.closeFrame")}
                      className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-rose-500"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeFrame(frame.id);
                      }}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </button>
                  </HoverTip>
                </div>
                <div className="relative shrink-0 bg-white" style={{ width: size.width, height: size.height }}>
                  {isImage ? (
                    <>
                      {/* Checkerboard behind transparent pixels (Trae parity). */}
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundColor: "#fff",
                          backgroundImage:
                            "conic-gradient(#e5e7eb 25%, #ffffff 0 50%, #e5e7eb 0 75%, #ffffff 0)",
                          backgroundSize: "16px 16px",
                        }}
                      />
                      {imgState === "ready" ? (
                        <img
                          src={imgSrcById[frame.id]}
                          alt={frame.title}
                          draggable={false}
                          className="absolute inset-0 block h-full w-full"
                          style={{ objectFit: "fill" }}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-text-faint">
                          {imgState === "failed" ? t("work.preview.imageLoadFailed") : t("work.preview.imageLoading")}
                        </div>
                      )}
                      {previewMode || editorMode ? null : (
                        <div
                          className="absolute inset-0 cursor-grab active:cursor-grabbing"
                          onPointerDown={(event) => beginFrameDrag(event, frame)}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {/* Keep the same wrapper across preview/editor toggles so the iframe is
                          NOT remounted and in-page state (scroll, inputs) survives. */}
                      <div
                        className={`absolute inset-0 ${previewMode || editorMode ? "" : "pointer-events-none [&_iframe]:pointer-events-none"}`}
                      >
                        <HtmlPreviewBody
                          key={`canvas-frame-${frame.id}-${frame.reloadNonce}`}
                          content={srcDocById[frame.id] ?? ""}
                          title={frame.title}
                          documentPath={frame.absolutePath}
                          visualEditorEnabled={editorMode}
                          visualEditorStyles={styleMapsByFrame[frame.id]}
                          visualEditorSelectedPath={
                            selection && selection.frameId === frame.id ? selection.payload.cssPath : null
                          }
                          onVisualEditorSelect={(payload) => handleEditorSelect(frame.id, payload)}
                        />
                      </div>
                      {/* Edit mode: previews are inert — pointer anywhere on the body
                          selects / drags the frame. Preview / visual-editor mode drops
                          this shield so the page receives real interactions. */}
                      {previewMode || editorMode ? null : (
                        <div
                          className="absolute inset-0 cursor-grab active:cursor-grabbing"
                          onPointerDown={(event) => beginFrameDrag(event, frame)}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {/* Selection corner handles — sibling overlay so the frame's
              overflow-hidden doesn't clip them (world coordinates). */}
          {selectedFrame && selectedBox ? (
            <div
              data-canvas-handles="1"
              className="pointer-events-none absolute"
              style={{ left: selectedBox.x, top: selectedBox.y, width: selectedBox.w, height: selectedBox.h }}
            >
              {([
                ["0%", "0%"],
                ["100%", "0%"],
                ["0%", "100%"],
                ["100%", "100%"],
              ] as const).map(([cx, cy]) => (
                <div
                  key={`${cx}-${cy}`}
                  className="absolute bg-white shadow-sm"
                  style={{
                    left: cx,
                    top: cy,
                    width: 9 / view.zoom,
                    height: 9 / view.zoom,
                    border: `${1.5 / view.zoom}px solid ${CANVAS_GREEN}`,
                    borderRadius: 2 / view.zoom,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty state */}
      {frames.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
          <div className="pointer-events-auto flex w-full max-w-[380px] flex-col items-center rounded-2xl border border-border bg-surface-popover/95 px-8 py-10 text-center shadow-lg backdrop-blur">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-hover text-text-subtle">
              <FrameIcon className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <div className="mt-4 text-[15px] font-semibold text-text-strong">{t("work.canvas.emptyTitle")}</div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-faint">{t("work.canvas.emptyHint")}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button
                ref={addBtnRef}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))]"
                onClick={openAddMenu}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                {t("work.canvas.add")}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-card px-3 py-1.5 text-[12.5px] text-text-strong transition hover:bg-surface-hover"
                onClick={onPickLocalFiles}
              >
                <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t("work.canvas.pickFile")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Top-center: selected frame device toolbar */}
      {frames.length > 0 ? (
        <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface-popover/95 px-1 py-0.5 shadow-sm backdrop-blur">
          <HoverTip label={t("work.canvas.add")}>
            <button
              ref={addBtnRef}
              type="button"
              aria-label={t("work.canvas.add")}
              aria-pressed={addOpen}
              className={`${toolBtn} ${addOpen ? "bg-surface-hover text-text-strong" : ""}`}
              onClick={() => (addOpen ? setAddOpen(false) : openAddMenu())}
            >
              <Plus className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <div className="mx-1 h-4 w-px bg-border" />
          <HoverTip label={`${previewMode ? t("work.canvas.exitPreview") : t("work.canvas.preview")} ⌥1`}>
            <button
              type="button"
              aria-label={previewMode ? t("work.canvas.exitPreview") : t("work.canvas.preview")}
              aria-pressed={previewMode}
              className={`${toolBtn} ${
                previewMode
                  ? "bg-[var(--ui-btn-primary-bg,#3b82f6)]/15 text-[var(--ui-btn-primary-bg,#3b82f6)] hover:bg-[var(--ui-btn-primary-bg,#3b82f6)]/20 hover:text-[var(--ui-btn-primary-bg,#3b82f6)]"
                  : ""
              }`}
              onClick={togglePreviewMode}
            >
              <Play className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <HoverTip label={`${t("work.canvas.editor")} ⌥3`}>
            <button
              type="button"
              aria-label={t("work.canvas.editor")}
              aria-pressed={editorMode}
              className={`${toolBtn} ${
                editorMode
                  ? "bg-[var(--ui-btn-primary-bg,#3b82f6)]/15 text-[var(--ui-btn-primary-bg,#3b82f6)] hover:bg-[var(--ui-btn-primary-bg,#3b82f6)]/20 hover:text-[var(--ui-btn-primary-bg,#3b82f6)]"
                  : ""
              }`}
              onClick={toggleEditorMode}
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <HoverTip label={`${edgesVisible ? t("work.canvas.hideEdges") : t("work.canvas.showEdges")} ⌥2`}>
            <button
              type="button"
              disabled={edges.length === 0}
              aria-label={edgesVisible ? t("work.canvas.hideEdges") : t("work.canvas.showEdges")}
              aria-pressed={edgesVisible}
              className={`${toolBtn} ${
                edgesVisible && edges.length > 0
                  ? "bg-[var(--ui-btn-primary-bg,#3b82f6)]/15 text-[var(--ui-btn-primary-bg,#3b82f6)] hover:bg-[var(--ui-btn-primary-bg,#3b82f6)]/20 hover:text-[var(--ui-btn-primary-bg,#3b82f6)]"
                  : ""
              }`}
              onClick={() => setEdgesVisible((v) => !v)}
            >
              <Workflow className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <div className="mx-1 h-4 w-px bg-border" />
          {deviceToolBtn("desktop", t("work.canvas.deviceDesktop"), <Monitor className="h-4 w-4" strokeWidth={1.7} />)}
          {deviceToolBtn("tablet", t("work.canvas.deviceTablet"), <Tablet className="h-4 w-4" strokeWidth={1.7} />)}
          {deviceToolBtn("phone", t("work.canvas.devicePhone"), <Smartphone className="h-4 w-4" strokeWidth={1.7} />)}
          <div className="mx-1 h-4 w-px bg-border" />
          <HoverTip label={selectedFrame ? t("work.canvas.refreshFrame") : t("work.canvas.selectFrameHint")}>
            <button
              type="button"
              disabled={!selectedFrame}
              aria-label={t("work.canvas.refreshFrame")}
              className={toolBtn}
              onClick={() => {
                if (!selectedFrame) return;
                bumpFrame(selectedFrame.id, { reloadNonce: selectedFrame.reloadNonce + 1 });
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <HoverTip label={selectedFrame ? t("work.canvas.fitFrame") : t("work.canvas.fitAll")}>
            <button
              type="button"
              aria-label={selectedFrame ? t("work.canvas.fitFrame") : t("work.canvas.fitAll")}
              className={toolBtn}
              onClick={() => fitAll(selectedFrame ? [selectedFrame] : undefined)}
            >
              <Maximize className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <div className="mx-1 h-4 w-px bg-border" />
          <HoverTip label={t("work.canvas.export")}>
            <button
              ref={exportBtnRef}
              type="button"
              aria-label={t("work.canvas.export")}
              aria-pressed={exportOpen}
              className={`${toolBtn} ${exportOpen ? "bg-surface-hover text-text-strong" : ""}`}
              onClick={() => (exportOpen ? setExportOpen(false) : openExportMenu())}
            >
              <Download className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
          <HoverTip label={t("work.canvas.more")}>
            <button
              ref={moreBtnRef}
              type="button"
              aria-label={t("work.canvas.more")}
              aria-pressed={moreOpen}
              className={`${toolBtn} ${moreOpen ? "bg-surface-hover text-text-strong" : ""}`}
              onClick={() => (moreOpen ? setMoreOpen(false) : openMoreMenu())}
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
        </div>
      ) : null}

      {/* Right: visual editor panel (Trae「设计」对标) */}
      {editorMode ? (
        <div
          data-canvas-editor="1"
          className="absolute bottom-0 right-0 top-0 z-20 flex w-[288px] flex-col border-l border-border bg-surface-popover"
        >
          <div className="flex h-10 shrink-0 items-center border-b border-border px-3">
            <span className="rounded-md bg-surface-hover px-2 py-0.5 text-[12px] font-medium text-text-strong">
              {t("work.canvas.editorDesign")}
            </span>
          </div>
          {!selection ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <MousePointerClick className="h-6 w-6 text-text-faint" strokeWidth={1.5} />
              <div className="mt-3 text-[12.5px] font-medium text-text-strong">
                {t("work.canvas.editorEmptyTitle")}
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-text-faint">
                {t("work.canvas.editorEmptyHint")}
              </div>
              <div className="mt-2.5 rounded-md border border-border bg-surface-card px-2 py-1 text-[11px] text-text-faint">
                {t("work.canvas.editorEmptyShortcut")}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Element chip */}
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="shrink-0 rounded bg-[var(--ui-btn-primary-bg,#3b82f6)]/10 px-1.5 py-0.5 font-mono text-[11px] text-[var(--ui-btn-primary-bg,#3b82f6)]">
                  {selection.payload.tagName}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[11.5px] text-text-faint"
                  title={selection.payload.cssPath}
                >
                  {selection.payload.selectorHint}
                </span>
                <HoverTip label={t("work.canvas.editorReset")}>
                  <button
                    type="button"
                    aria-label={t("work.canvas.editorReset")}
                    className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
                    onClick={resetElementEdits}
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} />
                  </button>
                </HoverTip>
              </div>

              {/* Layout: flex direction */}
              <div className="border-b border-border px-3 py-2.5">
                <div className={editorSectionTitle}>{t("work.canvas.editorLayout")}</div>
                <div className="mt-2 flex gap-1">
                  {(
                    [
                      ["row", t("work.canvas.editorDirRow"), <ArrowRight key="r" className="h-3.5 w-3.5" strokeWidth={1.7} />],
                      ["column", t("work.canvas.editorDirColumn"), <ArrowDown key="c" className="h-3.5 w-3.5" strokeWidth={1.7} />],
                      ["row-reverse", t("work.canvas.editorDirRowReverse"), <ArrowLeft key="rr" className="h-3.5 w-3.5" strokeWidth={1.7} />],
                      ["column-reverse", t("work.canvas.editorDirColumnReverse"), <ArrowUp key="cr" className="h-3.5 w-3.5" strokeWidth={1.7} />],
                    ] as const
                  ).map(([dir, label, icon]) => {
                    const active = selValue.flexDirection === dir;
                    return (
                      <HoverTip key={dir} label={label}>
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={active}
                          className={`flex h-7 flex-1 items-center justify-center rounded-md border transition-colors ${
                            active
                              ? "border-[var(--ui-btn-primary-bg,#3b82f6)] bg-[var(--ui-btn-primary-bg,#3b82f6)]/10 text-[var(--ui-btn-primary-bg,#3b82f6)]"
                              : "border-border text-text-muted hover:bg-surface-hover"
                          }`}
                          onClick={() => applyEdit("flexDirection", active ? undefined : dir)}
                        >
                          {icon}
                        </button>
                      </HoverTip>
                    );
                  })}
                </div>
              </div>

              {/* Spacing: margin / padding / gap */}
              <div className="border-b border-border px-3 py-2.5">
                <div className={editorSectionTitle}>{t("work.canvas.editorMargin")}</div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {spacingField("marginTop", 0)}
                  {spacingField("marginRight", 1)}
                  {spacingField("marginBottom", 2)}
                  {spacingField("marginLeft", 3)}
                </div>
                <div className={`${editorSectionTitle} mt-2.5`}>{t("work.canvas.editorPadding")}</div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {spacingField("paddingTop", 0)}
                  {spacingField("paddingRight", 1)}
                  {spacingField("paddingBottom", 2)}
                  {spacingField("paddingLeft", 3)}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className={editorSectionTitle}>{t("work.canvas.editorGap")}</span>
                  <input
                    type="number"
                    aria-label={t("work.canvas.editorGap")}
                    className={`${editorInput} w-20`}
                    value={selValue.gap}
                    onChange={(event) => applyEdit("gap", event.target.value)}
                  />
                </div>
              </div>

              {/* Appearance: opacity / radius */}
              <div className="border-b border-border px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={editorSectionTitle}>{t("work.canvas.editorOpacity")}</span>
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      aria-label={t("work.canvas.editorOpacity")}
                      className="h-1 flex-1 accent-[var(--ui-btn-primary-bg,#3b82f6)]"
                      value={selValue.opacity === "" ? 100 : Number(selValue.opacity)}
                      onChange={(event) => applyEdit("opacity", event.target.value)}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      aria-label={t("work.canvas.editorOpacity")}
                      className={`${editorInput} w-16`}
                      value={selValue.opacity}
                      onChange={(event) => applyEdit("opacity", event.target.value)}
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className={editorSectionTitle}>{t("work.canvas.editorRadius")}</span>
                  <input
                    type="number"
                    min={0}
                    aria-label={t("work.canvas.editorRadius")}
                    className={`${editorInput} w-20`}
                    value={selValue.borderRadius}
                    onChange={(event) => applyEdit("borderRadius", event.target.value)}
                  />
                </div>
              </div>

              {/* Transform: translate / rotate */}
              <div className="px-3 py-2.5">
                <div className={editorSectionTitle}>{t("work.canvas.editorTranslate")}</div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <label className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-faint">X</span>
                    <input
                      type="number"
                      aria-label="X"
                      className={editorInput}
                      value={selValue.translateX}
                      onChange={(event) => applyEdit("translateX", event.target.value)}
                    />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-faint">Y</span>
                    <input
                      type="number"
                      aria-label="Y"
                      className={editorInput}
                      value={selValue.translateY}
                      onChange={(event) => applyEdit("translateY", event.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className={editorSectionTitle}>{t("work.canvas.editorRotate")}</span>
                  <input
                    type="number"
                    aria-label={t("work.canvas.editorRotate")}
                    className={`${editorInput} w-20`}
                    value={selValue.rotate}
                    onChange={(event) => applyEdit("rotate", event.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Footer: save back to source file */}
          <div className="shrink-0 border-t border-border px-3 py-2.5">
            <button
              type="button"
              disabled={!hasUnsavedEdits || saveState === "saving"}
              className="w-full rounded-lg bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void saveEdits()}
            >
              {saveState === "saving" ? t("work.canvas.editorSaving") : t("work.canvas.editorSave")}
            </button>
            {saveState === "saved" ? (
              <div className="mt-1.5 text-center text-[11px] text-emerald-600">
                {t("work.canvas.editorSaved")}
              </div>
            ) : null}
            {saveState === "failed" ? (
              <div className="mt-1.5 text-center text-[11px] text-rose-500">
                {t("work.canvas.editorSaveFailed")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Bottom-right: zoom control */}
      {frames.length > 0 ? (
        <div
          className="absolute bottom-3 flex items-center gap-0.5 rounded-lg border border-border bg-surface-popover/95 px-1 py-0.5 shadow-sm backdrop-blur"
          style={{ right: editorMode ? 304 : 12 }}
        >
          <HoverTip label={t("work.canvas.zoomOut")}>
            <button type="button" aria-label={t("work.canvas.zoomOut")} className={toolBtn} onClick={() => zoomStep(-1)}>
              <Minus className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </HoverTip>
          <button
            type="button"
            className="min-w-[52px] rounded-md px-1 py-1 text-center text-[12px] font-medium tabular-nums text-text-strong hover:bg-surface-hover"
            title={t("work.canvas.zoomReset")}
            onClick={() =>
              setView((v) =>
                zoomAt(
                  v,
                  1,
                  (viewportRef.current?.clientWidth ?? 0) / 2,
                  (viewportRef.current?.clientHeight ?? 0) / 2,
                ),
              )
            }
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <HoverTip label={t("work.canvas.zoomIn")}>
            <button type="button" aria-label={t("work.canvas.zoomIn")} className={toolBtn} onClick={() => zoomStep(1)}>
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </HoverTip>
          <div className="mx-1 h-4 w-px bg-border" />
          <HoverTip label={t("work.canvas.fitAll")}>
            <button type="button" aria-label={t("work.canvas.fitAll")} className={toolBtn} onClick={() => fitAll()}>
              <Maximize className="h-4 w-4" strokeWidth={1.7} />
            </button>
          </HoverTip>
        </div>
      ) : null}

      {/* Bottom-left: gesture hint */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-surface-popover/85 px-2 py-1 text-[11px] text-text-faint backdrop-blur">
        {t("work.canvas.panHint")}
      </div>

      {/* Bottom-center: transient export feedback */}
      {exporting || exportFailed ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-surface-popover/95 px-2.5 py-1 text-[11.5px] text-text-strong shadow backdrop-blur">
          {exporting ? t("work.canvas.exporting") : t("work.canvas.exportFailed")}
        </div>
      ) : null}

      {addMenu}
      {moreMenu}
      {exportMenu}
      {scaleSubMenu("png")}
      {scaleSubMenu("jpeg")}

      {/* Trae-style floating green action bar for the selected frame.
          Positioned imperatively via rAF (see the frameElsRef effect). */}
      {selectedFrame
        ? createPortal(
            <div
              ref={floatingBarRef}
              data-canvas-floating-bar="1"
              className="fixed left-0 top-0 z-[110] flex h-8 items-center gap-0.5 rounded-full px-1 shadow-lg"
              style={{
                backgroundColor: CANVAS_GREEN,
                opacity: 0,
                pointerEvents: "none",
                transform: "translate3d(-9999px, -9999px, 0)",
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <HoverTip
                tone="dark"
                label={
                  addToChatState === "added"
                    ? t("work.canvas.addToChatDone")
                    : addToChatState === "error"
                      ? t("work.canvas.addToChatFailed")
                      : t("work.canvas.addToChat")
                }
              >
                <button
                  type="button"
                  className="flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-white transition-colors hover:bg-black/15 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
                  disabled={!onAddFrameToChat || addToChatState === "adding"}
                  onClick={() => void handleAddFrameToChat(selectedFrame)}
                >
                  {addToChatState === "adding" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                  <span className="whitespace-nowrap">
                    {addToChatState === "added"
                      ? t("work.canvas.addToChatDone")
                      : addToChatState === "error"
                        ? t("work.canvas.addToChatFailed")
                        : t("work.canvas.addToChat")}
                  </span>
                </button>
              </HoverTip>
              <HoverTip
                tone="dark"
                label={previewMode ? t("work.canvas.frameExitPreview") : t("work.canvas.framePreview")}
              >
                <button
                  type="button"
                  aria-label={previewMode ? t("work.canvas.frameExitPreview") : t("work.canvas.framePreview")}
                  aria-pressed={previewMode}
                  disabled={selectedFrame.kind === "image"}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white transition-colors hover:bg-black/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                  onClick={() => togglePreviewMode()}
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </HoverTip>
              <HoverTip tone="dark" label={t("work.canvas.frameMore")}>
                <button
                  ref={frameMoreBtnRef}
                  type="button"
                  aria-label={t("work.canvas.frameMore")}
                  aria-haspopup="menu"
                  aria-expanded={frameMenuOpen}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white transition-colors hover:bg-black/15"
                  onClick={() => openFrameMenu()}
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
                </button>
              </HoverTip>
            </div>,
            document.body,
          )
        : null}

      {/* Frame context menu (white card anchored to the green bar's … button). */}
      {frameMenuOpen && frameMenuPos && selectedFrame
        ? createPortal(
            <div
              role="menu"
              className="fixed z-[130] w-[208px] rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
              style={frameMenuPos}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className={menuItemCls}
                onClick={() => {
                  duplicateFrame(selectedFrame);
                  closeFrameMenu();
                }}
              >
                <Copy className={menuIconCls} strokeWidth={1.7} />
                {t("work.canvas.frameDuplicate")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItemCls}
                onClick={() => {
                  startRename(selectedFrame);
                  closeFrameMenu();
                }}
              >
                <Pencil className={menuIconCls} strokeWidth={1.7} />
                {t("work.canvas.frameRename")}
              </button>
              {/* Reserved: Regenerate is gated until the frame has an upstream agent task. */}
              <div title={t("work.canvas.frameRegenerateUnavailable")}>
                <button type="button" role="menuitem" disabled className={`${menuItemCls} w-full`}>
                  <RefreshCw className={menuIconCls} strokeWidth={1.7} />
                  {t("work.canvas.frameRegenerate")}
                </button>
              </div>
              <button
                type="button"
                role="menuitem"
                className={`${menuItemCls} justify-between`}
                onMouseEnter={(event) => showFrameSub("export", event.currentTarget.getBoundingClientRect())}
                onMouseLeave={scheduleHideFrameSub}
              >
                <span className="flex items-center gap-2">
                  <Download className={menuIconCls} strokeWidth={1.7} />
                  {t("work.canvas.frameExport")}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedFrame.kind === "image"}
                className={`${menuItemCls} justify-between`}
                onMouseEnter={(event) => {
                  if (selectedFrame.kind !== "image") showFrameSub("device", event.currentTarget.getBoundingClientRect());
                }}
                onMouseLeave={scheduleHideFrameSub}
              >
                <span className="flex items-center gap-2">
                  <Monitor className={menuIconCls} strokeWidth={1.7} />
                  {t("work.canvas.framePreviewDevice")}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.7} />
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-rose-500 hover:bg-rose-50"
                onClick={() => {
                  closeFrame(selectedFrame.id);
                  closeFrameMenu();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                {t("work.canvas.frameDelete")}
              </button>
            </div>,
            document.body,
          )
        : null}

      {/* Export → format submenu (level 2). */}
      {frameMenuOpen && frameSub === "export" && frameSubPos && selectedFrame
        ? createPortal(
            <div
              className="fixed z-[131] w-[168px] rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
              style={frameSubPos}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => window.clearTimeout(frameSubHideTimer.current)}
              onMouseLeave={scheduleHideFrameSub}
            >
              {(["png", "jpeg"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={exporting}
                  className={`${menuItemCls} justify-between`}
                  onMouseEnter={(event) => showFrameScale(format, event.currentTarget.getBoundingClientRect())}
                >
                  <span className="flex items-center gap-2">
                    <ImageIcon className={menuIconCls} strokeWidth={1.7} />
                    {format === "png" ? "PNG" : "JPG"}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.7} />
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}

      {/* Export → format → scale submenu (level 3). */}
      {frameMenuOpen && frameScaleFor && frameScalePos && selectedFrame
        ? createPortal(
            <div
              className="fixed z-[131] w-[128px] rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
              style={frameScalePos}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => window.clearTimeout(frameSubHideTimer.current)}
              onMouseLeave={scheduleHideFrameSub}
            >
              {[1, 2, 3].map((scale) => {
                const ready =
                  selectedFrame.kind === "image"
                    ? Boolean(imgSrcById[selectedFrame.id])
                    : Boolean(srcDocById[selectedFrame.id]);
                return (
                  <button
                    key={scale}
                    type="button"
                    disabled={!ready || exporting}
                    title={!ready ? t("work.canvas.exportNotReady") : undefined}
                    className={menuItemCls}
                    onClick={() => {
                      if (!ready || exporting) return;
                      exportFrameImage(frameScaleFor, scale);
                      closeFrameMenu();
                    }}
                  >
                    {scale}X
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}

      {/* Preview device submenu (level 2). */}
      {frameMenuOpen && frameSub === "device" && frameSubPos && selectedFrame
        ? createPortal(
            <div
              className="fixed z-[131] w-[168px] rounded-xl border border-border bg-surface-popover py-1.5 shadow-xl"
              style={frameSubPos}
              onMouseDown={(event) => event.stopPropagation()}
              onMouseEnter={() => window.clearTimeout(frameSubHideTimer.current)}
              onMouseLeave={scheduleHideFrameSub}
            >
              {(
                [
                  ["desktop", "work.canvas.deviceDesktop", <Monitor key="d" className={menuIconCls} strokeWidth={1.7} />],
                  ["tablet", "work.canvas.deviceTablet", <Tablet key="t" className={menuIconCls} strokeWidth={1.7} />],
                  ["phone", "work.canvas.devicePhone", <Smartphone key="p" className={menuIconCls} strokeWidth={1.7} />],
                ] as const
              ).map(([device, labelKey, icon]) => (
                <button
                  key={device}
                  type="button"
                  className={`${menuItemCls} justify-between`}
                  onClick={() => {
                    bumpFrame(selectedFrame.id, { device });
                    closeFrameMenu();
                  }}
                >
                  <span className="flex items-center gap-2">
                    {icon}
                    {t(labelKey)}
                  </span>
                  {selectedFrame.device === device ? (
                    <Check className="h-3.5 w-3.5 text-text-strong" strokeWidth={2.1} />
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
