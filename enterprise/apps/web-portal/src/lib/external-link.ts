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
  window.location.assign(`${EXTERNAL_LINK_PAGE}?${params.toString()}`);
}
