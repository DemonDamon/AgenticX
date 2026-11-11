// SP3 · screenshot executor — visible viewport of the active tab as base64 PNG.
//
// chrome.tabs.captureVisibleTab is the debugger-free path (master plan §3.3).
// The raw PNG base64 rides the NM channel inside the 1MB frame budget
// (fixture/typical viewport shots are a few hundred KB).
//
// Author: Damon Li

async function executeScreenshot(action) {
  const tab = await agxGetActiveTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const raw = String(dataUrl || "");
  const base64 = raw.replace(/^data:image\/png;base64,/, "");
  if (!base64 || base64 === raw) {
    return { ok: false, action, error: "screenshot_failed" };
  }
  return {
    ok: true,
    action,
    url: String(tab.url ?? ""),
    title: String(tab.title ?? ""),
    image_base64: base64,
    backend: "extension",
  };
}
