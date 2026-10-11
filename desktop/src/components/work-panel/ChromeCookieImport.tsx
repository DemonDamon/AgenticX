import { Cookie, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { SettingsSwitch } from "../settings/SettingsSwitch";
import {
  CHROME_COOKIE_IMPORT_STORAGE_KEY,
  parseChromeCookieImportState,
  shouldShowChromeCookieBanner,
} from "./chrome-cookie-import-state";

type ChromeProfile = { id: string; name: string; cookiePath: string };

type DialogPhase = "pick" | "importing" | "done" | "error";

function ChromeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <circle cx="24" cy="24" r="22" fill="#fff" />
      <path fill="#ea4335" d="M24 8a16 16 0 0 1 13.86 8H24z" />
      <path fill="#fbbc05" d="M37.86 16A16 16 0 0 1 32 37.86L24 24z" />
      <path fill="#34a853" d="M32 37.86A16 16 0 0 1 10.14 32L24 24z" />
      <path fill="#4285f4" d="M10.14 32A16 16 0 0 1 24 8v16z" />
      <circle cx="24" cy="24" r="7.2" fill="#fff" />
      <circle cx="24" cy="24" r="5" fill="#4285f4" />
    </svg>
  );
}

function persistState(next: { dismissed: boolean; importedAt?: number }): void {
  try {
    localStorage.setItem(CHROME_COOKIE_IMPORT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function importErrorMessage(code: string, t: (key: string) => string): string {
  if (code === "profile_not_found") return t("work.chromeCookieErrorProfile");
  if (code === "cookie_db_empty") return t("work.chromeCookieErrorEmpty");
  if (code === "import_zero") return t("work.chromeCookieErrorZero");
  if (code === "keychain_empty" || code.includes("errSec") || code.includes("-128")) {
    return t("work.chromeCookieErrorKeychain");
  }
  if (code === "unsupported_platform") return t("work.chromeCookieErrorPlatform");
  return t("work.chromeCookieErrorGeneric");
}

export function ChromeCookieImportBanner({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation("workspace");
  const [profiles, setProfiles] = useState<ChromeProfile[] | null>(null);
  const [hidden, setHidden] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    return parseChromeCookieImportState(localStorage.getItem(CHROME_COOKIE_IMPORT_STORAGE_KEY)).dismissed;
  });

  useEffect(() => {
    let cancelled = false;
    const list = window.agenticxDesktop?.listChromeCookieProfiles;
    if (!list) {
      setProfiles([]);
      return;
    }
    void list().then((result) => {
      if (cancelled) return;
      setProfiles(result?.ok ? result.profiles || [] : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => shouldShowChromeCookieBanner({ dismissed: hidden }, profiles?.length || 0),
    [hidden, profiles],
  );
  if (!visible) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-card px-3 py-2.5">
      <ChromeGlyph className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-text-strong">{t("work.chromeCookieBannerTitle")}</div>
        <div className="text-[11px] text-text-muted">{t("work.chromeCookieBannerHint")}</div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-full bg-[var(--ui-btn-primary-bg)] px-3.5 py-1 text-[12px] font-medium text-[var(--ui-btn-primary-text)]"
        onClick={onImport}
      >
        {t("work.chromeCookieImport")}
      </button>
      <button
        type="button"
        aria-label={t("work.chromeCookieDismiss")}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted hover:bg-surface-hover"
        onClick={() => {
          persistState({ dismissed: true });
          setHidden(true);
        }}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export function ChromeCookieImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}) {
  const { t } = useTranslation("workspace");
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [cookieOn, setCookieOn] = useState(true);
  const [phase, setPhase] = useState<DialogPhase>("pick");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhase("pick");
    setError("");
    setCookieOn(true);
    const list = window.agenticxDesktop?.listChromeCookieProfiles;
    if (!list) {
      setProfiles([]);
      return;
    }
    void list().then((result) => {
      const next = result?.ok ? result.profiles || [] : [];
      setProfiles(next);
      setProfileId((prev) => prev || next[0]?.id || "");
    });
  }, [open]);

  if (!open) return null;

  const runImport = async () => {
    if (!cookieOn || !profileId) return;
    setPhase("importing");
    setError("");
    try {
      const result = await window.agenticxDesktop.importChromeCookies({ profileId });
      if (!result?.ok) {
        setError(importErrorMessage(String(result?.error || ""), t));
        setPhase("error");
        return;
      }
      persistState({ dismissed: true, importedAt: Date.now() });
      setPhase("done");
      onImported?.();
    } catch (err) {
      setError(importErrorMessage(err instanceof Error ? err.message : String(err), t));
      setPhase("error");
    }
  };

  const title =
    phase === "done"
      ? t("work.chromeCookieDoneTitle")
      : t("work.chromeCookieDialogTitle");

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[420px] rounded-2xl border border-border bg-[var(--surface-base-fallback)] p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-[15px] font-medium text-text-strong">{title}</div>
          <button
            type="button"
            aria-label={t("work.chromeCookieDismiss")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-hover"
            onClick={onClose}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {phase === "importing" ? (
          <div className="py-10 text-center text-[13px] text-text-muted">{t("work.chromeCookieImporting")}</div>
        ) : phase === "done" ? (
          <div className="flex items-center gap-3 rounded-xl bg-surface-hover px-3 py-3">
            <Cookie className="h-5 w-5 text-text-muted" strokeWidth={1.7} />
            <div className="min-w-0 flex-1 text-[13px] text-text-strong">{t("work.chromeCookieDoneItem")}</div>
            <span className="text-[16px] text-emerald-500">✓</span>
          </div>
        ) : (
          <>
            <p className="mb-2 text-[12px] text-text-muted">{t("work.chromeCookieProfileLabel")}</p>
            <label className="mb-3 flex items-center gap-2 rounded-xl bg-surface-hover px-3 py-2">
              <ChromeGlyph className="h-5 w-5 shrink-0" />
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="min-w-0 flex-1 appearance-none bg-transparent py-1 pr-6 text-[13px] text-text-strong outline-none"
              >
                {profiles.length === 0 ? (
                  <option value="">{t("work.chromeCookieNoProfile")}</option>
                ) : (
                  profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <p className="mb-3 text-[12px] leading-relaxed text-text-faint">{t("work.chromeCookieQuitHint")}</p>
            <div className="flex items-center gap-3 rounded-xl bg-surface-hover px-3 py-3">
              <Cookie className="h-5 w-5 text-text-muted" strokeWidth={1.7} />
              <span className="flex-1 text-[13px] text-text-strong">Cookie</span>
              <SettingsSwitch
                checked={cookieOn}
                onChange={setCookieOn}
                aria-label="Cookie"
              />
            </div>
            {phase === "error" && error ? (
              <p className="mt-3 text-[12px] text-rose-500">{error}</p>
            ) : null}
          </>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {phase === "done" ? (
            <button
              type="button"
              className="rounded-full bg-[var(--ui-btn-primary-bg)] px-4 py-1.5 text-[13px] text-[var(--ui-btn-primary-text)]"
              onClick={onClose}
            >
              {t("work.chromeCookieFinish")}
            </button>
          ) : phase === "importing" ? (
            <button
              type="button"
              className="rounded-full bg-surface-hover px-4 py-1.5 text-[13px] text-text-strong"
              onClick={onClose}
            >
              {t("work.chromeCookieCancel")}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="rounded-full bg-surface-hover px-4 py-1.5 text-[13px] text-text-strong"
                onClick={onClose}
              >
                {t("work.chromeCookieCancel")}
              </button>
              <button
                type="button"
                disabled={!cookieOn || !profileId}
                className="rounded-full bg-[var(--ui-btn-primary-bg)] px-4 py-1.5 text-[13px] text-[var(--ui-btn-primary-text)] disabled:opacity-40"
                onClick={() => void runImport()}
              >
                {t("work.chromeCookieImport")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
