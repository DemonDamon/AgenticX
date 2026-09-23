import { useEffect, useMemo, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  STUDIO_STYLE_IDS,
  STUDIO_TWEAKS,
  buildStudioSvgDataUri,
  recipeWithShuffle,
  recipeWithStyle,
  recipeWithTweak,
  stylePreviewDataUri,
  tweakValue,
  type IdentityStudioRecipe,
  type StudioStyleId,
  type StudioTweakId,
} from "../../utils/identity-studio";

type Props = {
  nickname: string;
  onNicknameChange: (name: string) => void;
  recipe: IdentityStudioRecipe;
  onRecipeChange: (next: IdentityStudioRecipe) => void;
  onUploadFile: (file: File) => void;
  compact?: boolean;
};

const STYLE_LABEL_KEY: Record<StudioStyleId, string> = {
  "notionists-neutral": "profile.styleNotionists",
  "lorelei-neutral": "profile.styleLorelei",
  "bottts-neutral": "profile.styleBottts",
  "pixel-art-neutral": "profile.stylePixel",
  rings: "profile.styleRings",
};

const TWEAK_LABEL_KEY: Record<StudioTweakId, string> = {
  glasses: "profile.tweakGlasses",
  brows: "profile.tweakBrows",
  freckles: "profile.tweakFreckles",
  tone: "profile.tweakTone",
  accessory: "profile.tweakAccessory",
  rings: "profile.tweakRings",
  background: "profile.tweakBackground",
};

const CHOICE_LABEL_KEY: Record<string, string> = {
  "glasses:off": "profile.tweakGlassesOff",
  "glasses:on": "profile.tweakGlassesOn",
  "brows:soft": "profile.tweakBrowsSoft",
  "brows:strong": "profile.tweakBrowsStrong",
  "freckles:off": "profile.tweakFrecklesOff",
  "freckles:on": "profile.tweakFrecklesOn",
  "tone:dark": "profile.tweakToneDark",
  "tone:light": "profile.tweakToneLight",
  "accessory:off": "profile.tweakAccessoryOff",
  "accessory:on": "profile.tweakAccessoryOn",
  "rings:few": "profile.tweakRingsFew",
  "rings:many": "profile.tweakRingsMany",
  "background:none": "profile.tweakBackgroundNone",
  "background:light": "profile.tweakBackgroundLight",
};

export function IdentityStudio({
  nickname,
  onNicknameChange,
  recipe,
  onRecipeChange,
  onUploadFile,
  compact = false,
}: Props) {
  const { t } = useTranslation("settings");
  const fileRef = useRef<HTMLInputElement>(null);
  const nicknameRef = useRef(nickname);
  const recipeRef = useRef(recipe);
  const onNicknameChangeRef = useRef(onNicknameChange);
  const onRecipeChangeRef = useRef(onRecipeChange);
  const [draft, setDraft] = useState(nickname);
  const [tweaksOpen, setTweaksOpen] = useState(!compact);
  const [lit, setLit] = useState(true);

  nicknameRef.current = nickname;
  recipeRef.current = recipe;
  onNicknameChangeRef.current = onNicknameChange;
  onRecipeChangeRef.current = onRecipeChange;

  useEffect(() => {
    setDraft(nickname);
  }, [nickname]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const nextName = draft.slice(0, 48);
      if (nextName !== nicknameRef.current) onNicknameChangeRef.current(nextName);
      const current = recipeRef.current;
      if (current.seedFrozen) return;
      const seed = nextName.trim() || "me";
      if (seed !== current.seed) onRecipeChangeRef.current({ ...current, seed });
    }, 160);
    return () => window.clearTimeout(handle);
  }, [draft]);

  const previewSrc = useMemo(
    () => buildStudioSvgDataUri({ ...recipe, source: "studio" }),
    [recipe],
  );

  useEffect(() => {
    setLit(false);
    const handle = window.setTimeout(() => setLit(true), 30);
    return () => window.clearTimeout(handle);
  }, [previewSrc]);

  const tweaks = STUDIO_TWEAKS[recipe.style];

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`flex items-center justify-center overflow-hidden rounded-full bg-surface-card ${
          compact ? "h-24 w-24" : "h-40 w-40"
        }`}
      >
        <img
          data-testid="studio-preview"
          src={previewSrc}
          alt=""
          className={`h-full w-full object-cover transition-opacity duration-[180ms] ${
            lit ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      <label className="block w-full">
        <span className="mb-1.5 block text-xs font-medium text-text-muted">
          {t("profile.studioNickname")}
        </span>
        <input
          type="text"
          aria-label={t("profile.studioNickname")}
          maxLength={48}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-[rgba(var(--theme-color-rgb),0.5)] focus:outline-none focus:ring-1 focus:ring-[rgba(var(--theme-color-rgb),0.5)]"
        />
      </label>

      <div className="flex w-full items-center justify-center gap-1.5">
        {STUDIO_STYLE_IDS.map((styleId) => {
          const selected = recipe.style === styleId;
          const label = t(STYLE_LABEL_KEY[styleId]);
          return (
            <button
              key={styleId}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onRecipeChange(recipeWithStyle(recipe, styleId))}
              className={`flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95 ${
                selected
                  ? "border-text-primary bg-surface-panel shadow-sm"
                  : "border-transparent hover:bg-surface-hover"
              }`}
            >
              <img
                src={stylePreviewDataUri(styleId)}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            </button>
          );
        })}
      </div>

      <div className="flex w-full items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onRecipeChange(recipeWithShuffle(recipe))}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface-panel px-2.5 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <Shuffle className="h-3 w-3" />
          {t("profile.studioShuffle")}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-7 items-center rounded-md border border-border bg-surface-panel px-2.5 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          {t("profile.studioUsePhoto")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUploadFile(file);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="w-full">
        <button
          type="button"
          aria-expanded={tweaksOpen}
          onClick={() => setTweaksOpen((open) => !open)}
          className="text-[11px] text-text-faint transition-colors hover:text-text-muted"
        >
          {t("profile.studioTweak")}
        </button>
        {tweaksOpen ? (
          <div className="mt-2 flex flex-col gap-2">
            {tweaks.map((tweak) => (
              <div key={tweak.id} data-studio-tweak={tweak.id} className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[11px] text-text-faint">
                  {t(TWEAK_LABEL_KEY[tweak.id])}
                </span>
                {tweak.choices.map((choice) => {
                  const selected = tweakValue(recipe, tweak.id) === choice;
                  const choiceKey = CHOICE_LABEL_KEY[`${tweak.id}:${choice}`];
                  return (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onRecipeChange(recipeWithTweak(recipe, tweak.id, choice))}
                      className={`h-7 rounded-md px-2.5 text-[11px] transition-colors ${
                        selected
                          ? "bg-surface-card-strong text-text-strong"
                          : "text-text-muted hover:bg-surface-hover"
                      }`}
                    >
                      {choiceKey ? t(choiceKey) : choice}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <p className="w-full text-[11px] leading-snug text-text-faint">{t("profile.studioCredit")}</p>
    </div>
  );
}
