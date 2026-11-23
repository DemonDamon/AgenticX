// SP3 · screenshot executor — visible viewport of the active tab as base64 PNG.
//
// chrome.tabs.captureVisibleTab is the debugger-free path (master plan §3.3).
// The raw PNG base64 rides the NM channel inside the 1MB frame budget
// (fixture/typical viewport shots are a few hundred KB).
//
// SP6 · permission posture: captureVisibleTab needs a host grant for the
// captured tab — <all_urls> standing (never in the production manifest),
// activeTab (only right after a user gesture — agent-driven acts have none),
// or an optional host grant. The production posture is the OPTIONAL
// <all_urls> grant (manifest optional_host_permissions): the user enables
// "浏览器截图" once in the options page (a user gesture, so permissions.request
// is legal), after which agent screenshots work browser-wide; revocable the
// same way. Pre-check permissions so a missing grant fails with an actionable
// error instead of Chrome's raw capture exception.
//
// Author: Damon Li

async function agxScreenshotHostGranted(tab) {
  try {
    if (await chrome.permissions.contains({ origins: ["<all_urls>"] })) {
      return true;
    }
    const originPattern = agxBuildOriginPattern(tab.url); // inject.js (loaded by sw.js)
    if (originPattern && (await chrome.permissions.contains({ origins: [originPattern] }))) {
      return true;
    }
  } catch (err) {
    console.log("[agx-screenshot] permission pre-check failed:", err?.message ?? err);
  }
  return false;
}

async function executeScreenshot(action) {
  const tab = await agxGetActiveTab();
  if (!(await agxScreenshotHostGranted(tab))) {
    // Not a hard refusal: activeTab may still be live from a recent user
    // gesture on this tab — attempt once and fall through to the actionable
    // error if Chrome refuses the capture.
    try {
      return await agxCaptureVisibleTabReply(action, tab);
    } catch {
      return {
        ok: false,
        action,
        error: "screenshot_permission_required",
        hint: "浏览器截图权限未开启：请在扩展选项页（右键扩展图标 → 选项）启用「浏览器截图权限」后重试。",
        url: String(tab.url ?? ""),
      };
    }
  }
  return agxCaptureVisibleTabReply(action, tab);
}

async function agxCaptureVisibleTabReply(action, tab) {
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
