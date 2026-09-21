import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Shuffle, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BUNDLED_META_AVATAR_IM_ZOOM_CLASS,
  DEFAULT_META_AVATAR_URL,
  NEAR_CUBE_AVATAR_FIT_CLASS,
} from "../../constants/meta-avatar";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../ds/settings-typography";
import {
  BRAND_CUBE_COLORWAY_ID,
  CUBE_COLORWAYS,
  buildCubePortraitDataUrl,
  buildCubePortraitDataUrlFromWay,
  listCustomCubeColorways,
  pickRandomCubeColorwayId,
} from "../../utils/cube-colorway";
import { CUBE_GACHA_SYSTEM_PROMPT, commitGachaCubeColorway } from "../../utils/cube-gacha";
import { useAppStore } from "../../store";

type Props = {
  selectedId: string;
  onSelect: (colorwayId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function CubeSwatch({
  src,
  brand,
  selected,
  label,
  onClick,
}: {
  src: string;
  brand?: boolean;
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-transform active:scale-95 ${
        selected
          ? "border-text-primary bg-surface-panel shadow-sm"
          : "border-transparent hover:bg-surface-hover"
      }`}
    >
      <img
        src={src}
        alt=""
        className={`h-8 w-8 ${
          brand
            ? `origin-center object-cover ${BUNDLED_META_AVATAR_IM_ZOOM_CLASS}`
            : NEAR_CUBE_AVATAR_FIT_CLASS
        }`}
      />
    </button>
  );
}

export function UserCubeColorwayPicker({ selectedId, onSelect, open, onOpenChange }: Props) {
  const { t } = useTranslation("settings");
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const expanded = onOpenChange ? Boolean(open) : uncontrolledOpen;
  const setExpanded = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setUncontrolledOpen(next);
  };
  const [prompt, setPrompt] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [drawMessage, setDrawMessage] = useState("");
  const [skinsTick, setSkinsTick] = useState(0);
  const currentId = selectedId || BRAND_CUBE_COLORWAY_ID;
  const defaultPrompt = t("profile.costumeGachaPrompt");
  const swatches = useMemo(
    () =>
      CUBE_COLORWAYS.filter((way) => way.kind !== "shade").map((way) => ({
        id: way.id,
        src: buildCubePortraitDataUrl(way.id),
      })),
    [],
  );
  const customSwatches = useMemo(
    () =>
      listCustomCubeColorways().map((way) => ({
        id: way.id,
        src: buildCubePortraitDataUrlFromWay(way),
      })),
    [skinsTick],
  );

  const previewSrc =
    currentId === BRAND_CUBE_COLORWAY_ID
      ? DEFAULT_META_AVATAR_URL
      : buildCubePortraitDataUrl(currentId) || DEFAULT_META_AVATAR_URL;
  const previewBrand = currentId === BRAND_CUBE_COLORWAY_ID || !buildCubePortraitDataUrl(currentId);

  const drawSkin = async () => {
    const userPrompt = prompt.trim() || defaultPrompt;
    const store = useAppStore.getState();
    const settings = store.settings;
    const activeProvider = store.activeProvider || settings.defaultProvider || "";
    const providerEntry = settings.providers[activeProvider];
    setDrawing(true);
    setDrawMessage("");
    try {
      const res = await window.agenticxDesktop.aiAssistComplete({
        systemPrompt: CUBE_GACHA_SYSTEM_PROMPT,
        userPrompt,
        provider: activeProvider,
        apiKey: providerEntry?.apiKey ?? "",
        baseUrl: providerEntry?.baseUrl ?? "",
        model: providerEntry?.model ?? store.activeModel ?? "",
      });
      if (!res?.ok) {
        setDrawMessage(t("profile.aiAssistFailed", { reason: res?.error ?? t("commonSettings.unknownError") }));
        return;
      }
      const way = commitGachaCubeColorway(res.content ?? "");
      if (!way) {
        setDrawMessage(t("profile.costumeGachaInvalid"));
        return;
      }
      setSkinsTick((value) => value + 1);
      onSelect(way.id);
      setDrawMessage(t("profile.costumeGachaDone"));
    } catch (err) {
      setDrawMessage(t("profile.aiAssistFailed", { reason: String(err) }));
    } finally {
      setDrawing(false);
    }
  };

  const previewLabel =
    currentId === BRAND_CUBE_COLORWAY_ID ? t("profile.costumeBrand") : currentId;

  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
          expanded ? "bg-surface-hover/80" : "bg-surface-panel/45 hover:bg-surface-hover"
        }`}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-hover ${
            previewBrand ? "overflow-hidden" : "overflow-visible"
          }`}
        >
          <img
            src={previewSrc}
            alt=""
            className={`h-8 w-8 ${
              previewBrand
                ? `origin-center object-cover ${BUNDLED_META_AVATAR_IM_ZOOM_CLASS}`
                : NEAR_CUBE_AVATAR_FIT_CLASS
            }`}
          />
        </div>
        <span className="min-w-0 flex-1">
          <span className={`block ${SETTINGS_LABEL_CLASS}`}>{t("profile.costumeTitle")}</span>
          <span className={`mt-0.5 block ${SETTINGS_HINT_CLASS}`}>{t("profile.costumeHint")}</span>
        </span>
        <span className="hidden max-w-[32%] truncate text-[11px] text-text-faint md:block">
          {previewLabel}
        </span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-[var(--border-muted)] bg-surface-hover/30 px-3 pb-3 pt-2.5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">
              {t("profile.costumeGachaLabel")}
            </span>
            <textarea
              className="w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-[rgba(var(--theme-color-rgb),0.5)] focus:outline-none focus:ring-1 focus:ring-[rgba(var(--theme-color-rgb),0.5)]"
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={defaultPrompt}
            />
          </label>
          <div className="mt-2 mb-2 flex items-center justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-panel px-2.5 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
              onClick={() => onSelect(pickRandomCubeColorwayId(currentId))}
            >
              <Shuffle className="h-3 w-3" />
              {t("profile.costumeShuffle")}
            </button>
            <button
              type="button"
              disabled={drawing}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-btnPrimary px-2.5 text-[11px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
              onClick={() => void drawSkin()}
            >
              {drawing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {drawing ? t("profile.generating") : t("profile.costumeGachaDraw")}
            </button>
            {currentId !== BRAND_CUBE_COLORWAY_ID ? (
              <button
                type="button"
                className="h-7 rounded-md px-2.5 text-[11px] text-text-faint transition-colors hover:text-text-muted"
                onClick={() => onSelect(BRAND_CUBE_COLORWAY_ID)}
              >
                {t("profile.resetDefault")}
              </button>
            ) : null}
          </div>
          {drawMessage ? (
            <p className="mb-2 text-right text-[11px] text-text-faint">{drawMessage}</p>
          ) : null}
          <div className="grid grid-cols-6 gap-1.5">
            <CubeSwatch
              src={DEFAULT_META_AVATAR_URL}
              brand
              selected={currentId === BRAND_CUBE_COLORWAY_ID}
              label={t("profile.costumeBrand")}
              onClick={() => onSelect(BRAND_CUBE_COLORWAY_ID)}
            />
            {customSwatches.map((item) => (
              <CubeSwatch
                key={item.id}
                src={item.src}
                selected={currentId === item.id}
                label={item.id}
                onClick={() => onSelect(item.id)}
              />
            ))}
            {swatches.map((item) => (
              <CubeSwatch
                key={item.id}
                src={item.src}
                selected={currentId === item.id}
                label={item.id}
                onClick={() => onSelect(item.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
