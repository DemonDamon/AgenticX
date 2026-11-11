// SP4 · safety layer — sensitive-domain deny list (banking / payment / mail /
// government).
//
// The extension is the LAST line of defense (defense in depth): it holds the
// user's real logged-in Chrome session, so even if the agent-side url_guard is
// bypassed, actions touching these domains are refused here by default.
// Unlike url_guard.py this module does NOT implement private-network / danger
// protocol blocking — the agent side already owns that; here we only categorize
// hostnames.
//
// Matching: url.hostname is compared (case-insensitively) against each pattern
// as an exact host OR a parent domain, e.g. pattern "icbc.com.cn" matches
// "icbc.com.cn" and "www.icbc.com.cn" but never "fakeicbc.com.cn".
//
// Allow-list: a hostname can be explicitly un-blocked ONLY via the options page
// (chrome.storage.local, key AGX_ALLOW_KEY). There is no global off switch.
//
// Plain-script module (importScripts convention, no build toolchain). The
// module.exports tail makes the matcher unit-testable from plain node without
// a browser (the SP4 e2e uses it for pattern-level assertions).
//
// Author: Damon Li

/** chrome.storage.local key: { [hostname]: allowedAtEpochMs } */
const AGX_SAFETY_ALLOW_KEY = "agx_safety_allow";

/**
 * Built-in deny list, seeded from public category tables (banks / payment
 * providers / mailbox hosts / government). Patterns are registrable domains
 * or concrete hosts; keep this list conservative (default-deny for the listed
 * categories only — SP4 §0 anti-scope: no enterprise policy engine here).
 */
const AGX_SENSITIVE_DOMAIN_PATTERNS = [
  // --- banking (major CN banks + Citi CN) ---
  { category: "banking", pattern: "icbc.com.cn" }, // 工商银行
  { category: "banking", pattern: "ccb.com" }, // 建设银行
  { category: "banking", pattern: "abchina.com" }, // 农业银行
  { category: "banking", pattern: "boc.cn" }, // 中国银行
  { category: "banking", pattern: "bankcomm.com" }, // 交通银行
  { category: "banking", pattern: "psbc.com" }, // 邮储银行
  { category: "banking", pattern: "cmbchina.com" }, // 招商银行
  { category: "banking", pattern: "spdb.com.cn" }, // 浦发银行
  { category: "banking", pattern: "cib.com.cn" }, // 兴业银行
  { category: "banking", pattern: "citicbank.com" }, // 中信银行
  { category: "banking", pattern: "cgbchina.com" }, // 广发银行
  { category: "banking", pattern: "hxb.com.cn" }, // 华夏银行
  { category: "banking", pattern: "citibank.com.cn" }, // 花旗中国
  // --- payment ---
  { category: "payment", pattern: "alipay.com" }, // 支付宝
  { category: "payment", pattern: "tenpay.com" }, // 财付通
  { category: "payment", pattern: "unionpay.com" }, // 银联
  { category: "payment", pattern: "chinapay.com" }, // 银联在线支付
  { category: "payment", pattern: "paypal.com" },
  { category: "payment", pattern: "stripe.com" },
  // --- mailbox / account login ---
  { category: "mail", pattern: "mail.qq.com" }, // QQ 邮箱
  { category: "mail", pattern: "mail.163.com" }, // 网易邮箱
  { category: "mail", pattern: "outlook.live.com" }, // Outlook 网页邮箱
  { category: "mail", pattern: "accounts.google.com" }, // Google 账号登录
  // --- government / social security (whole category) ---
  { category: "gov", pattern: "gov.cn" }, // 各级政府/人社/社保站点
];

/**
 * Match a URL hostname against the built-in deny list.
 * Returns the matched {category, pattern} or null when the host is clean.
 * Pure function — safe to unit-test from node.
 */
function agxMatchSensitiveDomain(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return null;
  for (const entry of AGX_SENSITIVE_DOMAIN_PATTERNS) {
    const pattern = entry.pattern;
    if (host === pattern || host.endsWith(`.${pattern}`)) {
      return { category: entry.category, pattern };
    }
  }
  return null;
}

/** Extract the hostname from a URL string; "" when not a parseable http(s) URL. */
function agxHostnameOf(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.hostname.toLowerCase();
  } catch (err) {
    return "";
  }
}

// ---------------------------------------------------------------------------
// allow list (chrome.storage.local; only the options page writes it)
// ---------------------------------------------------------------------------

async function agxReadAllowList() {
  const store = await chrome.storage.local.get(AGX_SAFETY_ALLOW_KEY);
  const raw = store?.[AGX_SAFETY_ALLOW_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

/** Sorted list of {domain, allowedAt} for the options page. */
async function agxListAllowedDomains() {
  const allow = await agxReadAllowList();
  return Object.entries(allow)
    .map(([domain, allowedAt]) => ({ domain, allowedAt: Number(allowedAt) || 0 }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Persist an explicit allow for one hostname (options page only). */
async function agxAllowDomain(domain) {
  const host = String(domain || "").trim().toLowerCase();
  if (!host || !/^[a-z0-9.\-]+$/.test(host) || !host.includes(".")) {
    throw new Error("invalid_domain");
  }
  const allow = await agxReadAllowList();
  allow[host] = Date.now();
  await chrome.storage.local.set({ [AGX_SAFETY_ALLOW_KEY]: allow });
  return host;
}

/** Remove one hostname from the allow list (options page only). */
async function agxRevokeDomain(domain) {
  const host = String(domain || "").trim().toLowerCase();
  const allow = await agxReadAllowList();
  if (host in allow) {
    delete allow[host];
    await chrome.storage.local.set({ [AGX_SAFETY_ALLOW_KEY]: allow });
  }
}

/** True when this exact hostname was explicitly allowed via the options page. */
async function agxIsDomainAllowed(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return false;
  const allow = await agxReadAllowList();
  return Object.prototype.hasOwnProperty.call(allow, host);
}

/**
 * SP4 preActionHook step 1 — sensitive-domain verdict for an action.
 *
 * `open` is judged by its target URL; every other action is judged by the
 * active tab's URL (the page it would act on). Returns null when nothing
 * blocks, or {domain, category, tab_url} when the deny list hits and the
 * options-page allow list does not contain the hostname.
 */
async function agxSensitiveDomainVerdict(action, target) {
  let url = "";
  if (action === "open") {
    url = String(target?.url ?? "");
  } else {
    url = String(target?.tab_url ?? ""); // set by the preActionHook caller
  }
  const hostname = agxHostnameOf(url);
  if (!hostname) return null;
  const hit = agxMatchSensitiveDomain(hostname);
  if (!hit) return null;
  if (await agxIsDomainAllowed(hostname)) return null;
  return { domain: hostname, category: hit.category, tab_url: url };
}

// node-side unit-test hook (classic scripts never define `module`).
if (typeof module !== "undefined" && typeof module.exports !== "undefined") {
  module.exports = {
    AGX_SAFETY_ALLOW_KEY,
    AGX_SENSITIVE_DOMAIN_PATTERNS,
    agxMatchSensitiveDomain,
    agxHostnameOf,
    agxSensitiveDomainVerdict,
  };
}
