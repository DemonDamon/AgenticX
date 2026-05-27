export function openExternalUrl(url: string): void {
  const href = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(href)) return;
  const api = window.agenticxDesktop?.openExternal;
  if (typeof api === "function") {
    void api(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
