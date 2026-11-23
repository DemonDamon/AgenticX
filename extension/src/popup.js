// SP1 · NM Channel Spike — popup status page (debug only, not product UI).
// Mirrors the SW state persisted under chrome.storage.local key "nm".

const $ = (id) => document.getElementById(id);

function render(nm) {
  const connected = nm?.status === "connected";
  const status = $("status");
  status.textContent = connected ? "connected" : "disconnected";
  status.className = `val ${connected ? "ok" : "bad"}`;
  $("rtt").textContent = typeof nm?.lastRttMs === "number" ? `${nm.lastRttMs} ms` : "—";
  $("attempts").textContent = String(nm?.reconnectAttempts ?? 0);
  $("pong").textContent = nm?.lastPongAt ? new Date(nm.lastPongAt).toLocaleTimeString() : "—";
  $("samples").textContent = String(nm?.rttSamples?.length ?? 0);
}

async function refresh() {
  const { nm } = await chrome.storage.local.get("nm");
  render(nm);
}

refresh();
setInterval(refresh, 500);
