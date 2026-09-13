import { i18n } from "../../i18n/i18n";

export async function loadLocalPreviewDataUrl(
  absolutePath: string
): Promise<{ ok: true; dataUrl: string; mime?: string; size?: number } | { ok: false; error: string }> {
  const api = window.agenticxDesktop?.loadLocalFileDataUrl;
  if (typeof api !== "function") {
    return { ok: false, error: i18n.t("preview.clientNoLocalPreview", { ns: "workspace" }) };
  }
  try {
    const res = await api(absolutePath);
    if (!res.ok || !res.dataUrl) {
      return { ok: false, error: res.error ?? i18n.t("preview.fileLoadFailed", { ns: "workspace" }) };
    }
    return { ok: true, dataUrl: res.dataUrl, mime: res.mime, size: res.size };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

export function stripScriptTags(html: string): string {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}
