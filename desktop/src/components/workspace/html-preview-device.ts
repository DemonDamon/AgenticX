export type HtmlDevicePresetId =
  | "responsive"
  | "iphone-se"
  | "iphone-14"
  | "ipad"
  | "desktop";

export type HtmlDevicePreset = {
  id: HtmlDevicePresetId;
  label: string;
  width: number | null;
  height: number | null;
};

export const HTML_DEVICE_PRESETS: HtmlDevicePreset[] = [
  { id: "responsive", label: "Responsive", width: null, height: null },
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
  { id: "iphone-14", label: "iPhone 14", width: 390, height: 844 },
  { id: "ipad", label: "iPad", width: 768, height: 1024 },
  { id: "desktop", label: "Desktop", width: 1280, height: 800 },
];

export const HTML_ZOOM_OPTIONS = [50, 75, 100, 125, 150] as const;

export type HtmlPreviewViewport = {
  presetId: HtmlDevicePresetId;
  width: number | null;
  height: number | null;
  zoomPercent: number;
};

export const DEFAULT_HTML_PREVIEW_VIEWPORT: HtmlPreviewViewport = {
  presetId: "responsive",
  width: null,
  height: null,
  zoomPercent: 100,
};

export function applyDevicePreset(presetId: HtmlDevicePresetId): HtmlPreviewViewport {
  const preset = HTML_DEVICE_PRESETS.find((p) => p.id === presetId) ?? HTML_DEVICE_PRESETS[0];
  return {
    presetId: preset.id,
    width: preset.width,
    height: preset.height,
    zoomPercent: 100,
  };
}

export function rotateViewport(viewport: HtmlPreviewViewport): HtmlPreviewViewport {
  if (viewport.width == null || viewport.height == null) return viewport;
  return {
    ...viewport,
    presetId: "responsive",
    width: viewport.height,
    height: viewport.width,
  };
}

export function isFixedViewport(viewport: HtmlPreviewViewport): boolean {
  return viewport.width != null && viewport.height != null && viewport.width > 0 && viewport.height > 0;
}
