# Electron 主进程 fetch 支持 HTTP/HTTPS 代理

## Plan-Id
2026-05-26-electron-fetch-proxy-support

## Background

Near Desktop 设置页里「检测密钥」「拉取模型」「健康检查」三个按钮通过 Electron 主进程的 Node 自带 `fetch`（undici）发起外网请求。Node 18+ 的 `fetch` **故意不读取** `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 环境变量，导致：

- 用户 `export HTTPS_PROXY=http://127.0.0.1:7890` 后从同一终端 `npm run dev` 启动 Near
- 后端 `agx serve`（Python httpx / litellm）能正常走代理，聊天通畅
- 但设置页这几个按钮仍然 `TypeError: fetch failed`，直连被墙的 `api.mistral.ai` / `api.openai.com` / `api.anthropic.com`

只有开启 macOS「系统代理」时 Electron 的 Chromium 网络栈才会走代理，但 Node `fetch` 走的是独立的 undici 栈，不受 Chromium 代理设置影响。

## Goal

让设置页的密钥检测、模型列表拉取、健康检查在用户配置了 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` 环境变量时**自动走代理**，与 `agx serve` Python 子进程行为一致。

## Non-Goals

- 不改 Chromium 渲染进程的代理行为（已通过 `proxy-bypass-list <-loopback>` 处理本机回环）
- 不修改 SOCKS 代理逻辑外的网络层（仍优先走 HTTP CONNECT 隧道）
- 不引入 GUI 代理设置面板（环境变量驱动即可，符合现有 `agx serve` 行为）

## Requirements

### FR-1: 代理感知 fetch 工具
- 新增 `desktop/electron/proxy-fetch.ts`（或同等位置），导出 `proxyAwareFetch(url, init)` 函数
- 读取 `process.env.HTTPS_PROXY` → `HTTP_PROXY` → `ALL_PROXY`（大写小写都试，大写优先）
- 若任一非空，使用 `undici.ProxyAgent` 作为 `dispatcher`
- 若都为空，等价于直接 `globalThis.fetch`
- `NO_PROXY` / `no_proxy` 命中时不走代理（按域名后缀匹配）

### FR-2: 替换设置页 3 个 IPC handler
- `validate-key` (main.ts ~L5147)：把 `fetch(url, opts)` 改成 `proxyAwareFetch(url, opts)`
- `fetch-models` (main.ts ~L5186)：同上
- `health-check-model` (main.ts ~L5217)：同上

### FR-3: 依赖
- 在 `desktop/package.json` 加入 `undici` 作为 dependency（Electron 34 / Node 20 内置 undici 但不暴露顶层导入，必须显式装包）
- 选最新稳定版

### NFR-1: 兼容性
- 不影响未配置代理的用户（直连行为不变）
- `NO_PROXY=localhost,127.0.0.1,::1` 等回环目标继续直连
- TypeScript 严格模式编译通过，`npm run build` 无新增告警

### NFR-2: 可观测性
- 启动时如检测到代理变量，在主进程 console 打印一行 `[proxy] using HTTPS_PROXY=http://...:7890`（方便用户验证）
- 不打印密码/Token

## Acceptance Criteria

- AC-1: 用户在终端 `export HTTPS_PROXY=http://127.0.0.1:7890 && npm run dev`，设置页对 `https://api.mistral.ai/v1/models` 的「拉取模型」按钮**返回成功**（HTTP 200）
- AC-2: 没设置代理变量时，所有按钮行为与改动前一致（直连）
- AC-3: `HTTPS_PROXY` 端口设错（如 `127.0.0.1:9999`）时报错信息明确（包含 `ECONNREFUSED` 或 `connect failed`），而不是泛化 `fetch failed`
- AC-4: macOS 「系统代理」单独打开（未 export 环境变量）时不退化原有 Chromium 行为
- AC-5: `agx serve` 子进程仍正常继承环境变量（不在本次范围，但不应破坏）

## Implementation Steps

1. `cd desktop && npm install undici@latest`
2. 新建 `desktop/electron/proxy-fetch.ts`，实现 `proxyAwareFetch` 与 `NO_PROXY` 解析
3. 改 `desktop/electron/main.ts`：
   - 顶部 `import { proxyAwareFetch, logProxyConfig } from "./proxy-fetch"`
   - `app.whenReady()` 早期调用 `logProxyConfig()`
   - 3 处 `await fetch(url, ...)` 替换为 `await proxyAwareFetch(url, ...)`
4. `npm run build` 验证 TypeScript 通过
5. 手动验证 AC-1 / AC-2 / AC-3

## Files Affected

- `desktop/electron/main.ts`（3 处 fetch 替换 + 1 行 logProxyConfig 调用 + import）
- `desktop/electron/proxy-fetch.ts`（新增）
- `desktop/package.json` + `package-lock.json`（新增 undici 依赖）
- `.cursor/plans/2026-05-26-electron-fetch-proxy-support.plan.md`（本文件）

## Notes

- 用户实际命中此 bug 的场景：境内开发者用 Clash/Surge 配 Mistral / OpenAI / Anthropic 这类境外 provider，且不愿意开「系统代理」（影响其它应用流量分流）
- 这条改动也顺带修复同类报告：智谱/百炼之外的境外 OpenAI 兼容网关在设置页「拉取模型」失败
