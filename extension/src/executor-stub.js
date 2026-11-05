// SP2 · stub executor — returns a fixed payload for every action so the
// agent → bridge → NM → extension pipeline is verifiable end to end.
//
// SP3: the real executor (executor/ modules — chrome.scripting on the active
// tab, captureVisibleTab, storage.session index cache) is the default; this
// stub stays reachable when the desktop bridge pins AGX_EXT_STUB=1 (forwarded
// as stub:true on the act message) so the SP2 acceptance run is unbroken.
//
// Contract: the reply row is posted by sw.js as {type:"act_result", ...reply,
// request_id} — the desktop bridge settles the pending request by request_id.

function executeActionStub(message) {
  return {
    ok: true,
    action: message && message.action,
    url: "about:blank",
    text: "[stub]",
    backend: "extension",
  };
}
