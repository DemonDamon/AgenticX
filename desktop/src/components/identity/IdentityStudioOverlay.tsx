import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { defaultRecipe, type IdentityStudioRecipe } from "../../utils/identity-studio";
import { IdentityStudio } from "./IdentityStudio";

const MAX_AVATAR_BYTES = 1.8 * 1024 * 1024;

export function IdentityStudioOverlay() {
  const { t } = useTranslation("settings");
  const storedNickname = useAppStore((s) => s.userNickname);
  const commitStudioAvatar = useAppStore((s) => s.commitStudioAvatar);
  const setIdentityStudioSeen = useAppStore((s) => s.setIdentityStudioSeen);
  const setUserAvatarUrl = useAppStore((s) => s.setUserAvatarUrl);
  const setUserAvatarStudio = useAppStore((s) => s.setUserAvatarStudio);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const [name, setName] = useState(storedNickname);
  const [recipe, setRecipe] = useState<IdentityStudioRecipe>(() => defaultRecipe(storedNickname));
  const [message, setMessage] = useState("");

  const onUploadFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setMessage(t("profile.pickImage"));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setMessage(t("profile.imageTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setMessage(t("profile.readImageFailed"));
        return;
      }
      setUserNickname(name);
      setUserAvatarUrl(result);
      setUserAvatarStudio({ ...recipe, source: "upload" });
      setIdentityStudioSeen(true);
    };
    reader.onerror = () => setMessage(t("profile.readImageFailed"));
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("profile.studioTitle")}
    >
      <div className="w-[420px] max-w-[92vw] rounded-xl border border-border bg-surface-panel shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-strong">{t("profile.studioTitle")}</h2>
          <p className="mt-1 text-[11px] leading-snug text-text-faint">{t("profile.studioHint")}</p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          <IdentityStudio
            nickname={name}
            onNicknameChange={setName}
            recipe={recipe}
            onRecipeChange={setRecipe}
            onUploadFile={onUploadFile}
          />
          {message ? <p className="mt-2 text-right text-[11px] text-rose-400">{message}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setIdentityStudioSeen(true)}
            className="h-8 rounded-md px-3 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            {t("profile.studioSkip")}
          </button>
          <button
            type="button"
            onClick={() => commitStudioAvatar(recipe, name)}
            className="h-8 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:opacity-90"
          >
            {t("profile.studioConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
