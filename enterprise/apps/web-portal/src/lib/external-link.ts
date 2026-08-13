const EXTERNAL_LINK_PAGE = "/external-link";

function parseExternalUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Send a citation through the portal's external-link interstitial.
 * Only absolute HTTP(S) URLs are allowed; citation data must never become a
 * route or script redirect by accident.
 */
export function navigateToExternalLink(url: string, title?: string): void {
  if (typeof window === "undefined") return;
  const parsed = parseExternalUrl(url);
  if (!parsed) return;

  const params = new URLSearchParams({ url: parsed.href });
  const label = title?.trim();
  if (label) params.set("title", label);
  const interstitialUrl = `${EXTERNAL_LINK_PAGE}?${params.toString()}`;
  // Open a blank tab first so the opener can be severed before any document is
  // loaded. Passing `noopener` as a feature makes some browsers return null
  // even after opening, which is indistinguishable from popup blocking.
  const opened = window.open("", "_blank");
  if (opened) {
    try {
      opened.opener = null;
      opened.location.replace(interstitialUrl);
      return;
    } catch {
      opened.close();
    }
  }
  // Sandboxed report previews dispatch through postMessage, which may lose the
  // browser's transient user activation. Never turn those links into no-ops if
  // a popup policy blocks the new tab; the normal citation path stays in-place.
  window.location.assign(interstitialUrl);
}
