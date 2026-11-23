// SP3 · open executor — open or focus a tab at the given URL.
//
// Semantics mirror the embedded backend's "打开或复用浏览器 tab": an existing
// tab already showing the exact URL is re-focused instead of duplicated; a new
// URL gets a new active tab. Waits for status:complete within the 28s budget
// (bridge timeoutMsFor("open") is 30s — margin for the NM roundtrip).
//
// Author: Damon Li

async function executeOpen(action, message) {
  const url = String(message?.url ?? "").trim();
  if (!url) {
    return { ok: false, action, error: "missing_url" };
  }

  // Exact-URL reuse. tabs.query({url}) uses match patterns (which reject
  // port numbers), so compare tab.url strings manually instead.
  const allTabs = await chrome.tabs.query({});
  tab = allTabs.find((t) => t && t.url === url) ?? null;
  if (tab) {
    if (tab.active !== true) {
      await chrome.tabs.update(tab.id, { active: true });
    }
  } else {
    tab = await chrome.tabs.create({ url, active: true });
  }

  const deadline = Date.now() + AGX_OPEN_WAIT_BUDGET_MS;
  for (;;) {
    const current = await chrome.tabs.get(tab.id);
    if (current.status === "complete") {
      return {
        ok: true,
        action,
        url: current.url ?? url,
        title: current.title ?? "",
        tab_id: tab.id,
        backend: "extension",
      };
    }
    if (Date.now() > deadline) {
      return { ok: false, action, error: "open_timeout", url, tab_id: tab.id };
    }
    await agxSleep(150);
  }
}
