// SP3 · snapshot executor — indexed interactive-element list of the active tab.
//
// The result shape {ok, url, title, elements} with per-element {index, tag,
// type, text, placeholder, href, value_len, is_password} is the contract the
// agent prompt and agenticx/cli/agent_tools.py consume (snapshot indexes are
// referenced by click/type; is_password gates the type-confirm flow). The
// SP3 plan contract adds role/aria_label/rect per element.
//
// The snapshot is cached in chrome.storage.session (hard constraint: element
// index cache lives there, MV3-compliant session memory) so click/type can
// validate indexes and detect tab switches across SW recycles.
//
// Author: Damon Li

async function executeSnapshot(action) {
  const tab = await agxGetActiveTab();
  const result = await agxInject(tab.id, agxPageSnapshotCollector);
  const snapshot = {
    tabId: tab.id,
    ts: Date.now(),
    url: String(result.url ?? ""),
    title: String(result.title ?? ""),
    elements: Array.isArray(result.elements) ? result.elements : [],
  };
  await agxWriteLastSnapshot(snapshot);
  return {
    ok: true,
    action,
    url: snapshot.url,
    title: snapshot.title,
    elements: snapshot.elements,
    truncated: result.truncated === true,
    backend: "extension",
  };
}
