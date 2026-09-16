export const CHROME_COOKIE_IMPORT_STORAGE_KEY = "agx-chrome-cookie-import-v1";

export type ChromeCookieImportState = {
  dismissed: boolean;
  importedAt?: number;
};

export function parseChromeCookieImportState(raw: string | null): ChromeCookieImportState {
  if (!raw) return { dismissed: false };
  try {
    const parsed = JSON.parse(raw) as Partial<ChromeCookieImportState>;
    return {
      dismissed: Boolean(parsed.dismissed || parsed.importedAt),
      importedAt: typeof parsed.importedAt === "number" ? parsed.importedAt : undefined,
    };
  } catch {
    return { dismissed: false };
  }
}

export function shouldShowChromeCookieBanner(state: ChromeCookieImportState, profileCount: number): boolean {
  return profileCount > 0 && !state.dismissed;
}
