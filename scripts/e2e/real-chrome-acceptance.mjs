#!/usr/bin/env node
/**
 * 真机验收：在用户日常 Chrome（已装 AGX Bridge 扩展 + desktop bridge 在跑）上
 * 走一遍 agent 协议 → bridge HTTP → NM 通道 → 扩展执行 的完整链路。
 *
 * 用法：node scripts/e2e/real-chrome-acceptance.mjs [https://target-url]
 * 会在用户 Chrome 打开一个目标页标签（默认 example.com），跑完请手动关闭。
 *
 * 前置：
 *   - desktop（npm run dev）在跑，bridge HTTP 已监听
 *   - Chrome 已按 README 加载 unpacked 扩展（extension/）
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "https://example.com";

// AGX 数据目录：兼容 data_root.json 重定向（e2e 测试环境常见）与默认 ~/.agenticx
const home = homedir();
const redirect = join(home, ".agenticx", "data_root.json");
const dataDir = existsSync(redirect)
  ? JSON.parse(readFileSync(redirect, "utf8")).data_dir
  : join(home, ".agenticx");

const portFile = join(dataDir, "browser_bridge.port");
const tokenFile = join(dataDir, "browser_bridge.token");
if (!existsSync(portFile) || !existsSync(tokenFile)) {
  console.error(`FAIL: bridge files not found under ${dataDir} — is desktop bridge running?`);
  process.exit(1);
}
const base = `http://127.0.0.1:${readFileSync(portFile, "utf8").trim()}`;
const token = readFileSync(tokenFile, "utf8").trim();

const post = async (body) => {
  const res = await fetch(`${base}/v1/browser/act`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
};
const step = async (label, body) => {
  const t0 = Date.now();
  const r = await post({ session_id: "real-chrome-acceptance", ...body });
  const brief = { ...r };
  if (typeof brief.text === "string" && brief.text.length > 80) brief.text = brief.text.slice(0, 80) + "…";
  console.log(`  [${label}] ${Date.now() - t0}ms ${JSON.stringify(brief)}`);
  return r;
};

const status = await (async () => {
  const res = await fetch(`${base}/v1/browser/status`, { headers: { Authorization: `Bearer ${token}` } });
  return await res.json();
})();
console.log(`bridge ${base} status: ${JSON.stringify(status)}`);
if (status.extension_online !== true) {
  console.error("FAIL: extension not online — load extension/ in Chrome and retry");
  process.exit(1);
}

const opened = await step("open", { action: "open", url });
await new Promise((r) => setTimeout(r, 2000));
const snap = await step("snapshot", { action: "snapshot" });
const text = await step("extract_text", { action: "extract_text" });

const host = new URL(url).host;
const pass =
  opened?.ok !== false &&
  String(snap?.url || "").includes(host) &&
  (String(text?.text || "").length > 0 || String(text?.title || "").length > 0) &&
  Array.isArray(snap?.elements) &&
  snap.elements.length > 0;
console.log(pass ? "REAL-CHROME E2E: PASS" : "REAL-CHROME E2E: FAIL");
process.exit(pass ? 0 : 1);
