import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2 } from "lucide-react";
import { buildCubePortraitDataUrl } from "../../utils/cube-colorway";
import { applyCollectionStyleToExperts } from "../../utils/apply-expert-collection-style";
import {
  CUBE_PORTRAIT_STYLE,
  PORTRAIT_GROUPS,
  buildCollectionPortraitDataUri,
  loadCollectionPortraitStyle,
  type CollectionStyleId,
} from "../../utils/expert-portrait";

const LABEL_KEY: Record<CollectionStyleId, string> = {
  "near-cube-v3": "gallery.styleCube",
  blobs: "gallery.styleBlobs",
  disco: "gallery.styleDisco",
  identicon: "gallery.styleIdenticon",
  squircles: "gallery.styleSquircles",
  waves: "gallery.styleWaves",
  adventurer: "gallery.styleAdventurer",
  "adventurer-neutral": "gallery.styleAdventurerNeutral",
  avataaars: "gallery.styleAvataaars",
  bottts: "gallery.styleBottts",
  "bottts-neutral": "gallery.styleBotttsNeutral",
  clay: "gallery.styleClay",
  critters: "gallery.styleCritters",
  "croodles-neutral": "gallery.styleCroodlesNeutral",
  cutouts: "gallery.styleCutouts",
  "fun-emoji": "gallery.styleFunEmoji",
  gaze: "gallery.styleGaze",
  lorelei: "gallery.styleLorelei",
  micah: "gallery.styleMicah",
  thumbs: "gallery.styleThumbs",
  "voxel-art": "gallery.styleVoxelArt",
  "voxel-bot": "gallery.styleVoxelBot",
  landscape: "gallery.styleLandscape",
  planets: "gallery.stylePlanets",
};

type ExpertRow = {
  id: string;
  name: string;
  portraitStyle?: string;
  avatarUrl?: string;
};

function previewSrc(style: CollectionStyleId): string {
  if (style === CUBE_PORTRAIT_STYLE) return buildCubePortraitDataUrl("cotton");
  return buildCollectionPortraitDataUri(style, "Felix");
}

export function ExpertPortraitStyleControl({
  avatars,
  onApplied,
  onUpdated,
}: {
  avatars: ExpertRow[];
  onApplied: () => Promise<void> | void;
  onUpdated?: (row: { id: string; avatarUrl: string; portraitStyle: string }) => void;
}) {
  const { t } = useTranslation("sidebar");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CollectionStyleId>(() => loadCollectionPortraitStyle());
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 456;
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    setBox({ top: rect.bottom + 8, left });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !applying) setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (applying) return;
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", place);
    };
  }, [open, applying]);

  const choose = async (next: CollectionStyleId) => {
    if (applying) return;
    if (next === style) {
      setOpen(false);
      return;
    }
    setOpen(false);
    setApplying(true);
    setError("");
    try {
      const result = await applyCollectionStyleToExperts({
        style: next,
        avatars,
        updateAvatar: (payload) => window.agenticxDesktop.updateAvatar(payload),
        onUpdated,
      });
      if (result.updated > 0 || !result.error) setStyle(next);
      await onApplied();
      if (result.error) {
        setError(result.error);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const renderStyleButton = (id: CollectionStyleId) => {
    const selected = id === style;
    const label = t(LABEL_KEY[id]);
    return (
      <button
        key={id}
        type="button"
        disabled={applying}
        aria-label={label}
        aria-pressed={selected}
        onClick={() => void choose(id)}
        className="flex flex-col items-center gap-1 disabled:opacity-60"
      >
        <span
          className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border transition active:scale-95 ${
            selected
              ? "border-text-primary bg-surface-card shadow-sm ring-1 ring-text-primary"
              : "border-transparent hover:bg-surface-hover"
          }`}
        >
          <img src={previewSrc(id)} alt="" className="h-full w-full object-cover" />
        </span>
        <span className="max-w-full truncate text-[10px] leading-none text-text-faint">{label}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={applying}
        onClick={() => {
          if (applying) return;
          if (open) setOpen(false);
          else {
            place();
            setOpen(true);
          }
        }}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-panel px-3 text-[13px] text-text-strong transition hover:bg-surface-hover disabled:opacity-60"
      >
        <img src={previewSrc(style)} alt="" className="h-5 w-5 rounded-md object-cover" />
        {t("gallery.portraitStyle")}
        <ChevronDown className="h-3.5 w-3.5 text-text-faint" />
      </button>
      {applying ? (
        <Loader2
          className="h-4 w-4 animate-spin text-text-muted"
          aria-label={t("gallery.portraitApplying")}
        />
      ) : null}
      </div>
      {error ? (
        <p className="max-w-[240px] text-right text-[11px] leading-snug text-rose-400">
          {t("gallery.portraitApplyFailed", { error })}
        </p>
      ) : null}
      {open && box
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={t("gallery.portraitStyle")}
              className="fixed z-modal w-[456px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-surface-panel p-3 shadow-2xl"
              style={{ top: box.top, left: box.left }}
            >
              <p className="mb-3 text-[12px] leading-snug text-text-muted">
                {t("gallery.portraitStyleHint")}
              </p>
              <div className="max-h-[min(70vh,540px)] space-y-3 overflow-y-auto pr-1">
                <section>
                  <p className="mb-1.5 text-[11px] text-text-faint">{t("gallery.styleGroupCube")}</p>
                  <div className="grid grid-cols-6 gap-x-1 gap-y-2">
                    {renderStyleButton(CUBE_PORTRAIT_STYLE)}
                  </div>
                </section>
                {PORTRAIT_GROUPS.map((group) => (
                  <section key={group.id}>
                    <p className="mb-1.5 text-[11px] text-text-faint">{t(group.labelKey)}</p>
                    <div className="grid grid-cols-6 gap-x-1 gap-y-2">
                      {group.styles.map((id) => renderStyleButton(id))}
                    </div>
                  </section>
                ))}
                <p className="text-[10px] leading-snug text-text-faint">{t("gallery.portraitCredit")}</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
