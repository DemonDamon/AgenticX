# 桌面端「企业账号」登录入口（设备授权流 → 自动写入 enterprise PAT）

Planned-with: claude-opus-5
Suggested-Impl-Model: `gpt-5.6-sol-medium`（后端接线为主 + 一个常规表单区块，无需视觉重塑，也无跨栈高风险改动）

**Goal:** 用户在「设置 → 用户账号」里点一下「登录企业账号」，浏览器打开门户批准页，批准后桌面自动拿到 PAT 并落盘。全程**不手写 `~/.agenticx/config.yaml`**，也**不需要进管理台建 API 令牌**。

---

## 一、为什么要做（根因与证据链）

云房间面板（`desktop/src/components/CollabRoomPanel.tsx:20`）在未登录时展示「未登录企业账号，无法加载云房间」+「请先在设置里完成企业登录」。

但**设置里根本没有这个入口**。证据：

1. `desktop/src/settings-tab.ts:16-35` 的 `SETTINGS_TAB_IDS` 与 `desktop/src/components/SettingsPanel.tsx:1013-1030` 的 `TABS`，只有 `account`（「用户账号」），且该 Tab 渲染的 `AccountTab`（`desktop/src/components/AccountTab.tsx`）**通篇只有 Near 官网账号**（agxbuilder.com 设备流），无任何企业相关 UI。
2. 桌面全仓 grep `enterprise.token` 的写入方：只有 `desktop/electron/main.ts:2058-2061` 在 `scheduleEnterpriseCapabilitySync()` 里**回写** `capabilities` / `managed_*`，**没有任何代码写过 `enterprise.token` 或 `enterprise.base_url`**。
3. 判定登录与否的唯一依据是 `hasEnterprisePat(cfg)`（`desktop/electron/enterprise-capabilities-sync.ts:36-38`）：`Boolean(cfg.enterprise?.enabled && String(cfg.enterprise.token ?? "").trim())`。

结论：`enterprise.enabled` / `base_url` / `token` **只能靠用户手写 yaml**。这是缺口，不是设计。

**门户侧已经完备，本 plan 不碰门户。** 现成链路（均已实现并有单测）：

| 步骤 | 端点 | 文件 | 关键返回 |
|---|---|---|---|
| 1. 发起 | `POST /api/desktop/auth/device/init` | `enterprise/apps/web-portal/src/app/api/desktop/auth/device/init/route.ts:12` | `data: { deviceId, deviceSecret, verificationUrl, expiresIn, pollIntervalMs }` |
| 2. 批准（浏览器内，用户手动点） | 页面 `/auth/desktop?device=<deviceId>` | `enterprise/apps/web-portal/src/app/auth/desktop/page.tsx` | 内部 POST `/api/desktop/auth/device/approve` |
| 3. 轮询领取 | `POST /api/desktop/auth/device/poll` | `.../device/poll/route.ts:8` | `data.status` ∈ `pending` / `completed`；`completed` 时含 `token`（`agx-pat-*`）、`user: { userId, email, displayName, tenantId, deptId }`、`expiresAt` |
| 4. 放弃 | `POST /api/desktop/auth/device/cancel` | `.../device/cancel/route.ts` | — |

签发的 PAT scopes 为 `["workspace:chat", "desktop:managed"]`（`enterprise/apps/web-portal/src/lib/desktop-auth.ts:4`），正是 `/api/desktop/rooms/*` 需要的身份。

**注意 `init` 与 `poll` 的形状差异（易错点）：** `poll` 是 **POST** 且 body 需 `{ deviceId, deviceSecret }`（`route.ts:19-26`）。**不要**照抄官网账号那套 `GET .../device/poll?device_id=`（`desktop/electron/main.ts:7409-7411`）——那是 agxbuilder 官网的另一套协议，两者不通用。

---

## 二、可直接信任的现状（照抄这些形状）

| 件 | 精确位置 | 形状 |
|---|---|---|
| 官网账号设备流（**结构模板**，协议不同） | `desktop/electron/main.ts:7369-7460` `agx-account-login-start` / `-cancel` / `agx-account-logout` / `load-agx-account` | init → `shell.openExternal` → `setInterval` 轮询 → 写 cfg → `webContents.send` 通知渲染进程 |
| 轮询状态机全局量 | `desktop/electron/main.ts:1917-1936` | `agxAccountLoginPollTimer` / `...DeviceId` / `...PollTicks` + `clearAgxAccountLoginPoll()` |
| 配置读写 | `desktop/electron/main.ts:1469`（`loadAgxConfig`）/ `:1481`（`saveAgxConfig`） | 同文件内既有函数，yaml dump 全量回写 |
| `AgxConfig.enterprise` 类型 | `desktop/electron/main.ts:331-338` | `{ enabled?, base_url?, token?, capabilities?, managed_mcp_servers?, managed_skills? }` |
| 代理感知 fetch | `desktop/electron/proxy-fetch.ts:63` | `proxyAwareFetch(input, init?)`；`main.ts:57` 已 import |
| 门户 base 归一化 | `desktop/electron/collab-room-client.ts:21` | `normalizePortalBase(raw): string`；**复用它，不要再写一个** |
| 可注入 fetch 的纯客户端范例 | `desktop/electron/collab-room-client.ts` 整个文件 | `deps: { baseUrl, token, fetchImpl? }` + 中文错误短句映射 |
| preload 暴露风格 | `desktop/electron/preload.ts:931-957` | `agxAccountLoginStart` 等 5 个方法 + 2 个 `on*` 订阅（返回取消函数） |
| 渲染进程类型 | `desktop/src/global.d.ts:868-883` | 与 preload 一一对应 |
| 渲染进程首屏 hydration + 事件订阅 | `desktop/src/App.tsx:1617-1653` | `loadAgxAccount()` → `setAgxAccount`；`onAgxAccountChanged` / `onAgxAccountLoginTimeout` |
| 设置页账号区块 | `desktop/src/components/AccountTab.tsx:149-215` | 标题行 + 已登录卡片 / 未登录卡片二选一 |
| 主进程模块单测 | `desktop/tests/collab-room-client.test.ts` | `npm -C desktop test` 跑 `vitest run src tests` |

**孤儿键（可直接利用）：** 用户本机 `~/.agenticx/config.yaml` 已有 `enterprise.default_portal_url: http://127.0.0.1:3000`，但**全仓 grep 无任何读写方**。本 plan 把它正式收编为「门户地址默认值 / 上次使用值」。

---

## 三、落点清单

```
desktop/electron/enterprise-device-login.ts        (新增：纯函数 + 注入 fetch，可单测)
desktop/tests/enterprise-device-login.test.ts      (新增)
desktop/electron/main.ts                           (改：仅新增 import / 全局量 / IPC 块 / AgxConfig 字段)
desktop/electron/preload.ts                        (改：仅新增 enterpriseAccount* 方法)
desktop/src/global.d.ts                            (改：仅新增类型声明)
desktop/src/components/AccountTab.tsx              (改：新增「企业账号」区块)
desktop/electron/proxy-fetch.ts                    (改：仅新增 loopback 直连判断，见 FR-5)
```

**改动纪律：** `main.ts` 超长且敏感（仓库有过整段替换误删 import 致启动崩溃的事故）。只允许 (a) 既有 import 区新增行，(b) `AgxConfig.enterprise` 对象内新增字段行，(c) 在指定锚点**之后整块追加**。禁止「整段替换」覆盖相邻行。改完 `git diff --numstat desktop/electron/main.ts` 删除计数必须为 **0**。

---

## 四、FR

### FR-1 · 新模块 `desktop/electron/enterprise-device-login.ts`

不 import electron、不读磁盘，便于单测。

```ts
import { normalizePortalBase } from "./collab-room-client";

export type EnterpriseLoginDeps = {
  baseUrl: string;                 // 未归一化亦可，内部再 normalize 一次
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

export type EnterpriseLoginStart = {
  deviceId: string;
  deviceSecret: string;
  verificationUrl: string;
  expiresIn: number;
  pollIntervalMs: number;
};

export type EnterpriseLoginUser = {
  userId: string;
  email: string;
  displayName: string;
  tenantId: string;
  deptId: string | null;
};

export type EnterpriseLoginPoll =
  | { status: "pending" }
  | { status: "completed"; token: string; user: EnterpriseLoginUser; expiresAt: string }
  | { status: "gone"; error: string };

export type EnterpriseLoginResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

必须导出：

- `startEnterpriseDeviceAuth(deps, deviceName: string): Promise<EnterpriseLoginResult<EnterpriseLoginStart>>`
  → `POST {base}/api/desktop/auth/device/init`，body `{ deviceName }`，超时 `AbortSignal.timeout(15_000)`。
  返回体形状见「一、步骤 1」。**`verificationUrl` 原样透传**（门户已按 `x-forwarded-host` 算好 origin，见 `enterprise/apps/web-portal/src/lib/desktop-device-auth.ts:51-61`），不要自己拼。
- `pollEnterpriseDeviceAuth(deps, input: { deviceId: string; deviceSecret: string }): Promise<EnterpriseLoginResult<EnterpriseLoginPoll>>`
  → **POST** `{base}/api/desktop/auth/device/poll`，body `{ deviceId, deviceSecret }`。
  - HTTP 200 且 `data.status === "pending"` → `{ ok: true, data: { status: "pending" } }`
  - HTTP 200 且 `data.status === "completed"` → 带 `token` / `user` / `expiresAt`
  - HTTP 410（`code: "41001"`）→ `{ ok: true, data: { status: "gone", error: "授权请求已失效，请重新发起登录" } }`
  - HTTP 401 → `{ ok: true, data: { status: "gone", error: "授权信息无效，请重新发起登录" } }`
  - HTTP 429 → `{ ok: true, data: { status: "pending" } }`（限流不是失败，继续等下一拍）
  - 其它非 2xx / 网络异常 → `{ ok: false, error: ... }`，**调用方按「本拍失败、继续轮询」处理**，不要终止
- `cancelEnterpriseDeviceAuth(deps, input: { deviceId: string; deviceSecret: string }): Promise<void>`
  → `POST {base}/api/desktop/auth/device/cancel`，失败静默吞掉（best-effort）

**错误文案映射**（面向用户的中文短句，**禁止**拼入 URL / 门户地址 / token / 表名）：

| 情形 | 文案 |
|---|---|
| `baseUrl` 归一化后为空 | `"请先填写企业门户地址"` |
| HTTP 404（门户没有该接口） | `"该地址不是可用的企业门户"` |
| HTTP 429 (init 阶段) | `"请求过于频繁，请稍后再试"` |
| 其它非 2xx / 网络异常 / 超时 | `"无法连接企业门户，请检查地址与网络"` |

### FR-2 · `AgxConfig.enterprise` 新增字段

`desktop/electron/main.ts:331-338`，在既有对象内**追加三行**（不动既有字段）：

```ts
  enterprise?: {
    enabled?: boolean;
    base_url?: string;
    token?: string;
    capabilities?: unknown;
    managed_mcp_servers?: string[];
    managed_skills?: string[];
    /** 上次使用/预置的门户地址；登出后保留，用于下次登录预填。 */
    default_portal_url?: string;
    /** 仅用于设置页展示当前登录者，非鉴权依据。 */
    user_email?: string;
    user_display_name?: string;
  };
```

### FR-3 · 主进程 IPC

轮询状态机全局量，追加在 `desktop/electron/main.ts:1919`（`agxAccountLoginPollTicks` 声明）**之后**：

```ts
let enterpriseLoginPollTimer: NodeJS.Timeout | null = null;
let enterpriseLoginCtx: { deviceId: string; deviceSecret: string; baseUrl: string } | null = null;
let enterpriseLoginPollTicks = 0;

function clearEnterpriseLoginPoll(): void {
  if (enterpriseLoginPollTimer) {
    clearInterval(enterpriseLoginPollTimer);
    enterpriseLoginPollTimer = null;
  }
  enterpriseLoginCtx = null;
  enterpriseLoginPollTicks = 0;
}
```

**`deviceSecret` 只存在于主进程内存，禁止写盘、禁止进 IPC 返回值。**

IPC handler 整块追加在 `desktop/electron/main.ts:7460`（`load-agx-account` handler 结束）**之后**，与官网账号那组相邻：

| channel | 入参 | 行为 |
|---|---|---|
| `load-enterprise-account` | 无 | 读 cfg，返回 `{ ok: true, loggedIn: hasEnterprisePat(cfg), email, displayName, portalUrl }`；`portalUrl` 取 `cfg.enterprise?.base_url \|\| cfg.enterprise?.default_portal_url \|\| ""` |
| `enterprise-login-start` | `{ portalUrl?: string }` | 见下 |
| `enterprise-login-cancel` | 无 | `cancelEnterpriseDeviceAuth`（若有 ctx）后 `clearEnterpriseLoginPoll()`，返回 `{ ok: true }` |
| `enterprise-logout` | 无 | 见下 |

`enterprise-login-start` 流程：

1. `clearEnterpriseLoginPoll()`（同一时刻只允许一条授权流）
2. `const baseUrl = normalizePortalBase(payload?.portalUrl)`；为空则回落 `cfg.enterprise?.default_portal_url`；仍为空 → `{ ok: false, error: "请先填写企业门户地址" }`
3. `startEnterpriseDeviceAuth({ baseUrl, fetchImpl: proxyAwareFetch }, os.hostname())`；失败原样返回 `{ ok: false, error }`
4. **立刻持久化 `default_portal_url = baseUrl`**（即便后续没批准，下次也不用重填）
5. `void shell.openExternal(started.verificationUrl)`
6. 写 `enterpriseLoginCtx`，`setInterval` 按 `Math.max(started.pollIntervalMs, 1500)` 轮询：
   - `enterpriseLoginPollTicks += 1`；超过 `Math.ceil(started.expiresIn * 1000 / interval) + 4` 拍 → `clearEnterpriseLoginPoll()` + 向 `mainWindow?.webContents` 发 `enterprise-login-timeout`
   - `pending` → 继续
   - `{ ok: false }` → 记一拍失败继续（**连续 10 拍失败**才 `clearEnterpriseLoginPoll()` 并发 `enterprise-login-failed` 带中文 error）
   - `gone` → `clearEnterpriseLoginPoll()` + 发 `enterprise-login-failed` 带该 error
   - `completed` → 见下
7. 返回 `{ ok: true, verification_url: started.verificationUrl }`（供 UI 展示「没自动打开？点这里」；**不含** deviceSecret）

`completed` 落盘（**保留既有 `capabilities` / `managed_*`，只覆盖登录相关字段**）：

```ts
const cfg = loadAgxConfig();
cfg.enterprise = {
  ...(cfg.enterprise ?? {}),
  enabled: true,
  base_url: baseUrl,
  token: result.token,
  default_portal_url: baseUrl,
  user_email: result.user.email,
  user_display_name: result.user.displayName,
};
saveAgxConfig(cfg);
clearEnterpriseLoginPoll();
mainWindow?.webContents.send("enterprise-account-changed", {
  loggedIn: true,
  email: result.user.email,
  displayName: result.user.displayName,
  portalUrl: baseUrl,
});
void scheduleEnterpriseCapabilitySync().catch(() => null);   // 顺带拉一次能力包，失败不影响登录
```

`enterprise-logout`：清 `enabled` / `token` / `user_email` / `user_display_name`，**保留 `default_portal_url`**；`saveAgxConfig` 后发 `enterprise-account-changed`（`loggedIn: false`）。**不要**清 `capabilities` / `managed_mcp_servers` / `managed_skills`——那是 `enterprise-capabilities-sync` 的地盘，动它会误删本机已装的托管技能。

日志纪律：任何 `console.*` **不得**打印 token、deviceSecret、完整 verificationUrl。

### FR-4 · preload + 类型 + 渲染进程

`desktop/electron/preload.ts`，在 `:957`（`onAgxAccountLoginTimeout` 块结束）**之后**追加：

```ts
loadEnterpriseAccount: async () =>
  ipcRenderer.invoke("load-enterprise-account") as Promise<{
    ok: boolean;
    loggedIn?: boolean;
    email?: string;
    displayName?: string;
    portalUrl?: string;
  }>,
enterpriseLoginStart: async (payload: { portalUrl?: string }) =>
  ipcRenderer.invoke("enterprise-login-start", payload) as Promise<{
    ok: boolean;
    verification_url?: string;
    error?: string;
  }>,
enterpriseLoginCancel: async () =>
  ipcRenderer.invoke("enterprise-login-cancel") as Promise<{ ok: boolean }>,
enterpriseLogout: async () => ipcRenderer.invoke("enterprise-logout") as Promise<{ ok: boolean }>,
onEnterpriseAccountChanged: (
  cb: (payload: { loggedIn: boolean; email: string; displayName: string; portalUrl: string }) => void,
): (() => void) => {
  const handler = (_e: unknown, payload: never) => cb(payload);
  ipcRenderer.on("enterprise-account-changed", handler as never);
  return () => ipcRenderer.removeListener("enterprise-account-changed", handler as never);
},
onEnterpriseLoginFailed: (cb: (payload: { error: string }) => void): (() => void) => {
  const handler = (_e: unknown, payload: never) => cb(payload);
  ipcRenderer.on("enterprise-login-failed", handler as never);
  return () => ipcRenderer.removeListener("enterprise-login-failed", handler as never);
},
onEnterpriseLoginTimeout: (cb: () => void): (() => void) => {
  const handler = () => cb();
  ipcRenderer.on("enterprise-login-timeout", handler);
  return () => ipcRenderer.removeListener("enterprise-login-timeout", handler);
},
```

`desktop/src/global.d.ts`：在 `:883`（`onAgxAccountLoginTimeout` 声明）**之后**追加一一对应的签名。

**订阅函数必须返回取消函数**（与既有 `onAgxAccountChanged` 约定一致），否则组件卸载后泄漏监听。

### FR-5 · `proxyAwareFetch` 回环地址直连

**为什么必须在本 plan 内做（非顺手优化）：** 本机门户是 `http://127.0.0.1:3000`。`desktop/electron/proxy-fetch.ts:63-88` 目前只要 `HTTPS_PROXY`/`ALL_PROXY` 等任一非空、且 `NO_PROXY` 未显式包含 `127.0.0.1`，就会把回环请求也塞进 ProxyAgent，必然连不上。开发机普遍 export 了代理（本仓库文档多处要求 curl 加 `--noproxy '*'` 即为佐证），`npm run dev` 启动的 Electron 会继承这些变量。不修则 AC-4/AC-5 在本机**必然失败**，且同一缺陷同样影响已交付的云房间（`collab-room-client` 走同一个 `proxyAwareFetch`）。

改动**仅新增**一个判断，插在 `proxy-fetch.ts:77` 的 `hostMatchesNoProxy` 判断**之前**：

```ts
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}
```

```ts
  if (isLoopbackHost(host)) return fetch(input, init);
```

不改 `getProxyUrl` / `getNoProxyList` / `hostMatchesNoProxy` 的任何既有行为。

### FR-6 · 设置页「企业账号」区块

`desktop/src/components/AccountTab.tsx`：在既有官网账号区块（`:149-213` 的最外层 `div` 内、`:212` 收尾之后）**追加**一个并列区块。**不改**官网账号区块的任何一行。

- 组件内新增 local state（**不动 `desktop/src/store.ts`**，避免为一个设置页区块扩全局 store）：
  `entLoggedIn` / `entEmail` / `entDisplayName` / `entPortalUrl` / `entBusy` / `entWaiting` / `entError`
- `useEffect` 首屏调 `window.agenticxDesktop.loadEnterpriseAccount()` 回填；订阅 `onEnterpriseAccountChanged` / `onEnterpriseLoginFailed` / `onEnterpriseLoginTimeout`，**卸载时调用三个取消函数**
- 标题：`企业账号`；说明文案（不写具体端口 / 不写仓库路径）：
  > 登录企业门户后，即可在「云房间」里与同事协作。点击登录将在系统浏览器中完成授权。
- 未登录态：
  - 一个「企业门户地址」输入框，`value={entPortalUrl}`，`placeholder="https://portal.example.com"`，首屏由 `loadEnterpriseAccount()` 的 `portalUrl` 预填
  - 主按钮「登录企业账号」→ `enterpriseLoginStart({ portalUrl: entPortalUrl })`
  - `ok: false` → 就地在区块内展示 `error`（**不弹窗**），不清空输入框
  - `ok: true` → 进入等待态：spinner +「等待浏览器中完成授权…」+「取消等待」按钮（调 `enterpriseLoginCancel()`）；同时展示一行「没有自动打开？」+ 可点击的 `verification_url`
- 已登录态：展示 `entDisplayName || entEmail`、`entEmail`（`font-mono text-xs`）、门户地址，以及「退出企业账号」按钮
  - 退出前用 `window.agenticxDesktop.confirmDialog({ ..., destructive: true })` 二次确认（照抄 `AccountTab.tsx:137-147` 的 `onLogout`）
  - 文案用「退出登录」，不用「删除」
- 样式只用既有 token（`border-border` / `bg-surface-card` / `text-text-subtle` 等）与本文件已 import 的 `Button`；**禁止**硬编码十六进制颜色
- 图标复用文件顶部已有的 `safeLucide` 包装（`AccountTab.tsx:8-15`），新增图标按同样方式包一层，不要直接用裸 lucide 组件

---

## 五、单测 `desktop/tests/enterprise-device-login.test.ts`

只测 `enterprise-device-login.ts`（不起 Electron），用注入的 `fetchImpl` 造返回。

| 用例 | 断言 |
|---|---|
| `startEnterpriseDeviceAuth posts the device name to the portal` | 请求 URL 以 `/api/desktop/auth/device/init` 结尾；body 解析后为 `{ deviceName: "mac-1" }` |
| `startEnterpriseDeviceAuth returns the portal verification url as-is` | 门户返回 `verificationUrl: "http://127.0.0.1:3000/auth/desktop?device=abc"` → `data.verificationUrl` 完全相等（未被重拼） |
| `startEnterpriseDeviceAuth rejects an empty portal url` | `baseUrl: "   "` → `{ ok: false, error: "请先填写企业门户地址" }`，且 `fetchImpl` **未被调用** |
| `startEnterpriseDeviceAuth maps 404 to a wrong-portal message` | `{ ok: false, error: "该地址不是可用的企业门户" }` |
| `pollEnterpriseDeviceAuth posts deviceId and deviceSecret` | 方法为 `POST`；body 解析后含 `deviceId` 与 `deviceSecret` 两个 key |
| `pollEnterpriseDeviceAuth maps pending` | 门户回 `{ data: { status: "pending" } }` → `data.status === "pending"` |
| `pollEnterpriseDeviceAuth maps completed with token and user` | 回 `completed` → `data.token === "agx-pat-x"`，`data.user.email === "a@example.com"` |
| `pollEnterpriseDeviceAuth treats 429 as pending` | HTTP 429 → `{ ok: true, data: { status: "pending" } }` |
| `pollEnterpriseDeviceAuth maps 410 to gone` | HTTP 410 → `data.status === "gone"`，`data.error` 含「重新发起登录」 |
| `error messages never leak the portal url or token` | 各错误路径下 `error` 不含 `"http"`、不含 `"agx-pat"` |

`desktop/tests/proxy-fetch.test.ts`（若不存在则新建，只测 FR-5 新增行为）：

| 用例 | 断言 |
|---|---|
| `proxyAwareFetch bypasses the proxy for loopback hosts` | 设 `process.env.HTTPS_PROXY = "http://127.0.0.1:7890"`，请求 `http://127.0.0.1:3000/x` 时走 `globalThis.fetch`（用 `vi.stubGlobal("fetch", spy)` 断言 spy 被调用）；用例结束恢复 env |

---

## 六、AC

- **AC-1**：`npm -C desktop test` 全绿，含第五节全部用例。
- **AC-2**：`npx tsc -p desktop/electron/tsconfig.json --noEmit` 通过。
- **AC-3**：`git diff --numstat desktop/electron/main.ts` 的**删除行数为 0**。`git diff --name-only` 不含 `enterprise/`（本 plan 一行门户代码都不改）。
- **AC-4**（本机手测，前置：`bash enterprise/scripts/start-dev.sh --ui=stream --webpack` 已起、门户 `:3000` 可访问；改完主进程后**完全退出并重启** `npm -C desktop run dev`）：
  1. 先把 `~/.agenticx/config.yaml` 里 `enterprise` 段清成只剩 `default_portal_url`
  2. 设置 → 用户账号 → 「企业账号」区块可见，地址框已预填 `http://127.0.0.1:3000`
  3. 点「登录企业账号」→ 系统浏览器打开 `/auth/desktop?device=…`；若未登录门户则先跳登录页，登录后回到批准页
  4. 页面点批准 → **≤5s** 内桌面区块自动变为已登录，显示门户账号邮箱
  5. `~/.agenticx/config.yaml` 的 `enterprise` 出现 `enabled: true` / `base_url` / `token: agx-pat-…` / `user_email`
- **AC-5**：紧接 AC-4，顶栏点「云房间」→ **不再**显示「未登录企业账号」；门户里若已有含该账号的房间则出现在列表中（无房间时显示既有空态文案，同样算通过）。
- **AC-6**：点「退出企业账号」并确认 → 区块回到未登录态；配置里 `token` 与 `enabled` 已清、`default_portal_url` **仍在**、`managed_skills` / `capabilities` **未被改动**。
- **AC-7**：地址框填一个非门户地址（如 `http://127.0.0.1:9`）再点登录 → 区块内就地显示「无法连接企业门户，请检查地址与网络」，**不弹系统弹窗**、不白屏，主进程无未捕获异常。
- **AC-8**：整轮结束后，主进程 dev 终端日志中 `grep -c 'agx-pat'` 为 0（token 未被打印）。

---

## 七、In scope / Out of scope

**In scope：** 第三节落点清单里的 7 个文件（2 新增 + 5 处仅追加）。

**Out of scope（实施者不要顺手做）：**

- 改门户 `enterprise/` 下任何代码，包括 `/api/desktop/auth/**`、`/api/desktop/rooms/**`、`lib/collab-room/**`
- 改 admin-console 的 API 令牌页
- 改 `desktop/src/store.ts`（企业账号状态留在 `AccountTab` 本地 state）
- 改 `CollabRoomPanel.tsx`（它已有正确空态，登录后自然恢复）
- 把企业账号与 Near 官网账号（`agx_account`）做任何形式的合并、互斥或联动
- 改 `remote_server` 语义
- 多租户切换、多企业账号并存、PAT 到期自动续签（本波次只做「登录 / 退出」）
- 改 `scheduleEnterpriseCapabilitySync()` 既有逻辑（只允许在登录成功后调用它）
- 动 `desktop/package.json` 的 undici 版本（钉 `^6.x`）

---

## 八、易错点

| 坑 | 规避 |
|---|---|
| 照抄官网账号的 `GET /device/poll?device_id=` | 企业侧是 **POST** + body `{ deviceId, deviceSecret }`，协议不通用（FR-1 已写明） |
| 自己拼批准页 URL | 用门户返回的 `verificationUrl`；门户按 `x-forwarded-host` 算 origin，自己拼会在 `localhost` / `127.0.0.1` 之间错配导致 cookie 域不一致、批准后仍 pending |
| `deviceSecret` 写盘或回传渲染进程 | 只放主进程内存，`clearEnterpriseLoginPoll()` 时清空 |
| 登出时把 `capabilities` / `managed_skills` 一起删 | 只清 4 个登录字段，其余原样保留（FR-3） |
| 用 `cfg.enterprise = { enabled, base_url, token }` 整体赋值 | 必须 `...(cfg.enterprise ?? {})` 展开，否则托管技能清单丢失 |
| 轮询一拍网络抖动就判失败退出 | 连续 10 拍失败才终止；429 视为 pending |
| 本机代理把 `127.0.0.1` 也代理走 | FR-5 的 loopback 直连；不做则 AC-4 必失败 |
| 只刷新渲染进程验 IPC | 改了主进程必须**完全退出重启** `npm run dev`（`tsc --watch` 只重编译 `dist-electron/`，主进程不热重载） |
| 订阅未返回取消函数 | 三个 `on*` 均返回 `() => ipcRenderer.removeListener(...)`，组件卸载时调用 |
| 错误文案泄露门户地址 / token | 统一走 FR-1 的映射表；AC-8 兜底 |
| 整段替换误删 `main.ts` 相邻行 | AC-3 用删除行数为 0 兜底 |
