// SP4 · safety options page — sensitive-domain allow management (minimal UI).
//
// The ONLY way to un-block a built-in sensitive domain: type its hostname
// here and confirm. Writes chrome.storage.local under the key defined in
// safety/domains.js. No global off switch exists anywhere.
//
// SP5 · page-inject origins — the host grants requested per-site by the
// context-menu items (inject.js). Listed via chrome.permissions.getAll and
// revoked via chrome.permissions.remove; nothing else can grant them.
//
// Author: Damon Li

const $ = (id) => document.getElementById(id);

function setStatus(text, isError) {
  const el = $("allow-status");
  el.textContent = text || "";
  el.style.color = isError ? "#c0392b" : "#2c7a4b";
}

function fmtWhen(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function renderAllowList(entries) {
  const list = $("allow-list");
  list.textContent = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "（尚未放行任何域名）";
    list.appendChild(li);
    return;
  }
  for (const entry of entries) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.innerHTML = `<span class="domain"></span> <span class="when"></span>`;
    left.querySelector(".domain").textContent = entry.domain;
    left.querySelector(".when").textContent = entry.allowedAt ? `放行于 ${fmtWhen(entry.allowedAt)}` : "";
    const remove = document.createElement("button");
    remove.textContent = "撤销放行";
    remove.addEventListener("click", async () => {
      try {
        await agxRevokeDomain(entry.domain);
        await refresh();
        setStatus(`已撤销对 ${entry.domain} 的放行`);
      } catch (err) {
        setStatus(`撤销失败：${err?.message ?? err}`, true);
      }
    });
    li.appendChild(left);
    li.appendChild(remove);
    list.appendChild(li);
  }
}

function renderDenyList() {
  $("deny-count").textContent = String(AGX_SENSITIVE_DOMAIN_PATTERNS.length);
  const ul = $("deny-list");
  ul.textContent = "";
  for (const entry of AGX_SENSITIVE_DOMAIN_PATTERNS) {
    const li = document.createElement("li");
    li.textContent = entry.pattern;
    ul.appendChild(li);
  }
}

async function refresh() {
  const entries = await agxListAllowedDomains();
  renderAllowList(entries);
  return entries;
}

async function onAllow() {
  const input = $("domain-input");
  const raw = input.value.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  try {
    const host = await agxAllowDomain(raw);
    input.value = "";
    await refresh();
    setStatus(`已放行 ${host}（记录在案，可随时撤销）`);
  } catch (err) {
    setStatus(err?.message === "invalid_domain" ? "请输入有效的域名，例如 mail.qq.com" : `放行失败：${err?.message ?? err}`, true);
  }
}

$("allow-btn").addEventListener("click", onAllow);
$("domain-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault(); // the page has no <form>: Enter must not look like a submit
    void onAllow();
  }
});

renderDenyList();
void refresh();
void refreshInjectOrigins();
void refreshScreenshotGrant();
void refreshEnterpriseDeny();

// Keep the list live: the allow list may also be written by another view of
// this page open in another tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[AGX_SAFETY_ALLOW_KEY]) void refresh();
  if (area === "local" && changes[AGX_ENTERPRISE_DENY_KEY]) void refreshEnterpriseDeny();
});

// SP5: permissions events keep the inject-origin list live (grants arrive
// from context-menu requests in the service worker, revocations from here).
// SP6: they also keep the screenshot-grant buttons in sync.
chrome.permissions.onAdded?.addListener(() => {
  void refreshInjectOrigins();
  void refreshScreenshotGrant();
});
chrome.permissions.onRemoved?.addListener(() => {
  void refreshInjectOrigins();
  void refreshScreenshotGrant();
});

// ---------------------------------------------------------------------------
// SP5 · page-inject granted origins (view / revoke)
// ---------------------------------------------------------------------------

function setInjectStatus(text) {
  $("inject-origin-status").textContent = text || "";
}

async function refreshInjectOrigins() {
  const list = $("inject-origin-list");
  list.textContent = "";
  const all = await chrome.permissions.getAll();
  const origins = (all?.origins ?? []).filter((origin) => typeof origin === "string" && origin.trim());
  if (!origins.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "（尚未授权任何站点）";
    list.appendChild(li);
    return;
  }
  for (const origin of origins) {
    const li = document.createElement("li");
    const left = document.createElement("span");
    left.className = "domain";
    left.textContent = origin;
    const remove = document.createElement("button");
    remove.textContent = "回收权限";
    remove.addEventListener("click", async () => {
      try {
        const removed = await chrome.permissions.remove({ origins: [origin] });
        if (!removed) throw new Error("remove_returned_false");
        await refreshInjectOrigins();
        setInjectStatus(`已回收 ${origin} 的注入权限`);
      } catch (err) {
        setInjectStatus(`回收失败：${err?.message ?? err}`);
      }
    });
    li.appendChild(left);
    li.appendChild(remove);
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// SP6 · browser screenshot grant (optional <all_urls>, enable/revoke here).
// e2e posture: the automation copy patches standing host_permissions instead;
// this UI is the production path for the agent-driven screenshot action.
// ---------------------------------------------------------------------------

const AGX_SCREENSHOT_ORIGINS = ["<all_urls>"];

function setScreenshotStatus(text, isError) {
  const el = $("screenshot-status");
  el.textContent = text || "";
  el.style.color = isError ? "#c0392b" : "#2c7a4b";
}

async function refreshScreenshotGrant() {
  const granted = await chrome.permissions.contains({ origins: AGX_SCREENSHOT_ORIGINS });
  $("screenshot-enable-btn").disabled = granted;
  $("screenshot-revoke-btn").disabled = !granted;
  setScreenshotStatus(
    granted ? "已启用：AGX 可截取任意站点的当前可视区域。" : "未启用：AGX 的截图操作会被拒绝。",
    false,
  );
}

$("screenshot-enable-btn").addEventListener("click", async () => {
  try {
    const granted = await chrome.permissions.request({ origins: AGX_SCREENSHOT_ORIGINS });
    if (!granted) {
      setScreenshotStatus("已取消：未授权截图权限。", true);
      return;
    }
    await refreshScreenshotGrant();
  } catch (err) {
    setScreenshotStatus(`启用失败：${err?.message ?? err}`, true);
  }
});

$("screenshot-revoke-btn").addEventListener("click", async () => {
  try {
    const removed = await chrome.permissions.remove({ origins: AGX_SCREENSHOT_ORIGINS });
    if (!removed) throw new Error("remove_returned_false");
    await refreshScreenshotGrant();
  } catch (err) {
    setScreenshotStatus(`关闭失败：${err?.message ?? err}`, true);
  }
});

// ---------------------------------------------------------------------------
// SP6 · enterprise deny list (pushed by the desktop bridge over NM; read-only).
// ---------------------------------------------------------------------------

async function refreshEnterpriseDeny() {
  const el = $("enterprise-deny-note");
  try {
    const store = await chrome.storage.local.get(AGX_ENTERPRISE_DENY_KEY);
    const rows = Array.isArray(store?.[AGX_ENTERPRISE_DENY_KEY]) ? store[AGX_ENTERPRISE_DENY_KEY] : [];
    if (!rows.length) {
      el.textContent = "尚未收到企业下发的额外拦截域名（连接 AGX 桌面端后自动同步）。";
      return;
    }
    el.textContent = `企业已下发 ${rows.length} 个额外拦截域名（在内置清单之外，且不可在此放行）：${rows.join("、")}`;
  } catch (err) {
    el.textContent = `读取企业策略失败：${err?.message ?? err}`;
  }
}
