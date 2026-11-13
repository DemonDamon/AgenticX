// SP3 · extract_text executor — visible page text (shadow DOM + same-origin
// iframes) with the agent-side query filter semantics.
//
// Author: Damon Li

async function executeExtractText(action, message) {
  const query = String(message?.query ?? "").trim();
  const tab = await agxGetActiveTab();
  const result = await agxInject(tab.id, agxPageExtractCollector, [query]);
  return {
    ok: true,
    action,
    url: String(result.url ?? ""),
    title: String(result.title ?? ""),
    text: String(result.text ?? ""),
    backend: "extension",
  };
}
