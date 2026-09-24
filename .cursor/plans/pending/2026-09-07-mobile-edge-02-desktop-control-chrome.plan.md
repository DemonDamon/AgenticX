# 02 · 桌面：授权开关、唤醒、底栏药丸

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Master:** `.cursor/plans/pending/2026-09-07-mobile-edge-control-master.plan.md`  
**依赖:** 01 已合并（`/api/desktop/edge/*` 可用）。  
**Goal:** Near Desktop 增加「手机控制」设置页：允许控制 + 保持唤醒；企业登录后心跳；侧栏底栏显示「手机」状态丸。

**Architecture:** 复用已有企业 PAT（`enterpriseLogin*` / bootstrap）。主进程登记 fingerprint、20s 心跳。渲染进程只画开关与药丸。唤醒开关与 Automation 共用 `prevent_sleep`。

**Tech Stack:** Electron main/preload、React、现有 Settings 体系、vitest。

---

## 实施前必读 skill（按序）

1. `.agents/skills/redesign-existing-projects/SKILL.md`
2. `.agents/skills/emil-design-eng/SKILL.md`
3. `.agents/skills/apple-design/SKILL.md`（只取按压反馈 / 材料，不做 sheet）
4. Master 第 5 节设计宪法

**Design Read：** 与 Master 第 5 节同一句。  
**Dials：** VARIANCE 3 / MOTION 4 / DENSITY 5。

禁止：新图标库、新主色、外发光、`transition: all`、入场 `scale(0)`、改 `RunModePicker`、改 Automation 任务列表逻辑。

---

## In scope

- 设置 Tab `mobile_control`
- 抽出 `PreventSleepToggle` 供 Automation 与新 Tab 共用
- 底栏药丸 `MobileEdgeStatusPill`
- 主进程：fingerprint 文件、register、heartbeat、grant IPC
- 对应 vitest

## Out of scope

- portal / admin UI
- 本机接任务（05）
- 改 `desktop_device_auth` 登录流
- 改 `ChatPane` 发送链路
- 局域网 `lan_access`

---

## 根因与落点

- Tab 白名单：`desktop/src/settings-tab.ts` `SETTINGS_TAB_IDS`（约 L16–35）。缺 id 则 `openSettings("mobile_control")` 被 `isSettingsTab` 丢掉。
- 左侧导航：`desktop/src/components/SettingsPanel.tsx` `TABS`（约 L1013–1030）与 `{tab === "automation" && (`（约 L8921）。
- 防休眠 UI：`desktop/src/components/automation/AutomationTab.tsx` `PreventSleepToggle`（L10–88），IPC 已通。
- 底栏：`desktop/src/components/SidebarAccountBar.tsx`（L11–32）。测试：`SidebarAccountBar.test.tsx`。
- 企业登录：`desktop/electron/main.ts` `enterprise-login-start`（约 L7537）。PAT 已在主进程，渲染层不要碰明文。
- `openSettings`：`desktop/src/store.ts` L2694。

---

## FR / AC

- **FR-02-1** 设置出现「手机控制」；未企业登录时两开关禁用，说明「请先登录企业账号」。
  - **AC-02-1** `desktop/src/components/settings/mobile-control/MobileControlTab.test.tsx` 静态 HTML 含「请先登录企业账号」，开关 `disabled`。
- **FR-02-2** 打开「允许手机控制这台电脑」调用 grant `enabled: true`；关闭则 false。副文案含 180 天与「已创建任务的文件夹」。info 气泡文案必须是 Master 第 4 节那句（禁止改写）。
  - **AC-02-2** 同测试 mock IPC，点击后调用 `saveMobileControlGrant({ enabled: true })`。
- **FR-02-3** 「保持电脑唤醒」与 Automation「抑制系统睡眠」读写同一 `prevent_sleep`。
  - **AC-02-3** AutomationTab 仍渲染抽出后的 `PreventSleepToggle`；两边文案可以不同，IPC 都是 `saveAutomationConfig({ prevent_sleep })`。
- **FR-02-4** 企业登录成功后主进程 register + 每 20s heartbeat；退出登录停止。
  - **AC-02-4** `desktop/electron/mobile-edge-heartbeat.test.ts`（纯函数测「应不应 tick」）；或把调度器抽到 `desktop/electron/mobile-edge.ts` 单测，禁止为测心跳改登录状态机。
- **FR-02-5** 底栏药丸：未登录或不可控制时不出现；`controllable && online` 显示绿点「手机」；仅授权未在线显示灰点「手机 · 离线」。点击 `openSettings("mobile_control")`。
  - **AC-02-5** 扩展 `SidebarAccountBar.test.tsx`：mock 状态后 HTML 含/不含「手机」。
- **FR-02-6** 药丸与设置开关 200ms ease-out，`:active` `scale(0.97)`，`prefers-reduced-motion` 下无位移。

---

### Task 1: SettingsTab id

**Files:**

- Modify: `desktop/src/settings-tab.ts`

在 `SETTINGS_TAB_IDS` 的 `"account"` 后插入 `"mobile_control"`。

Before:

```ts
export const SETTINGS_TAB_IDS = [
  "account",
  "general",
```

After:

```ts
export const SETTINGS_TAB_IDS = [
  "account",
  "mobile_control",
  "general",
```

若有枚举测试，一并更新。不要删 `hooks` / `email` 等已有 id。

---

### Task 2: 抽出 PreventSleepToggle

**Files:**

- Create: `desktop/src/components/settings/PreventSleepToggle.tsx`
- Modify: `desktop/src/components/automation/AutomationTab.tsx` 删除本地函数，改为 import

抽出时 **默认文案保持 Automation 原文**（「抑制系统睡眠」+ 现有副文案），通过 optional props 覆盖：

```tsx
type Props = {
  title?: string;
  description?: string;
  ariaOn?: string;
  ariaOff?: string;
};
```

MobileControlTab 传入：

- title: `保持电脑唤醒`
- description: `任务运行期间尽量避免系统睡眠，以便手机发起的任务能继续执行。退出 Near 后不再拦截。`
- 不要把 Automation 原标题改成「保持电脑唤醒」（避免改用户已熟悉的 Automation 文案）。

开关 class 原样搬迁。滑块 `duration-200 ease-out`。`@media (hover: hover) and (pointer: fine)` 才加 hover 亮度。

---

### Task 3: MobileControlTab

**Files:**

- Create: `desktop/src/components/settings/mobile-control/MobileControlTab.tsx`
- Create: `desktop/src/components/settings/mobile-control/MobileControlTab.test.tsx`
- Modify: `desktop/src/components/SettingsPanel.tsx`
  - `TABS` 在 account 后加 `{ id: "mobile_control", label: "手机控制", icon: Smartphone }`（`Smartphone` 来自已有 lucide-react）
  - 在 `tab === "automation"` 旁增加 `tab === "mobile_control" && <MobileControlTab />`

页面结构（单列，不要卡片套卡片）：

1. 一段说明，含 info 按钮。Tooltip 原文：`为支持跨设备访问，仅对话内容和 AI 生成的产物会存到云端。`
2. 行 1：允许手机控制这台电脑。副文：`允许访问已创建任务的文件夹。有效期 180 天。` 若已授权，再跟一行 `到期：YYYY-MM-DD`（用 grant 返回的 `expiresAt`，本地时区日期即可）。
3. 行 2：`PreventSleepToggle` 覆盖文案。
4. 未登录：两行 switch `disabled`，顶部 muted 提示 `请先登录企业账号后再开启。`

开关视觉必须复用 PreventSleepToggle 的 track/thumb，不要做第二种 switch。

到期日禁止用 em dash。写成 `到期: 2027-03-06`。

`agxAccount.loggedIn === false` 时不调用 grant API。

---

### Task 4: 主进程登记与心跳

**Files:**

- Create: `desktop/electron/mobile-edge.ts`
- Create: `desktop/electron/mobile-edge-heartbeat.test.ts`
- Modify: `desktop/electron/main.ts`（只在企业登录成功 / logout / app quit 处各加函数调用，禁止大段替换 import）
- Modify: `desktop/electron/preload.ts` + `desktop/src/global.d.ts`

Fingerprint 文件：`~/.agenticx/edge-device.json`

```json
{ "fingerprint": "<ulid or uuid>", "createdAt": "<iso>" }
```

没有则创建。不要写 PAT。

`displayName`：`os.hostname()` 截断到 128。

调度：

```ts
export const EDGE_HEARTBEAT_MS = 20_000;

export function shouldSendHeartbeat(args: {
  loggedIn: boolean;
  lastSentAt: number | null;
  now: number;
}): boolean {
  if (!args.loggedIn) return false;
  if (args.lastSentAt == null) return true;
  return args.now - args.lastSentAt >= EDGE_HEARTBEAT_MS;
}
```

登录成功（已有 PAT 写入之后）立刻 `register` + `heartbeat`，然后 `setInterval` 20s。`enterpriseLogout` 与 `app.on("before-quit")` 必须 `clearInterval`。

HTTP：用 Desktop 现有企业请求封装（与 bootstrap 同一 baseUrl + `Authorization: Bearer <pat>`）。路径：

- POST `{portal}/api/desktop/edge/register`
- POST `{portal}/api/desktop/edge/heartbeat`
- POST `{portal}/api/desktop/edge/grant`
- GET `{portal}/api/desktop/edge/status`

若现有 helper 在 `main.ts` 内部且抽不出来，允许在 `mobile-edge.ts` 接收 `fetchImpl` 与 `getToken` 注入，便于单测。禁止把 PAT 打进 log。

IPC：

```
load-mobile-edge-status -> { loggedIn, controllable, online, expiresAt, error? }
save-mobile-control-grant -> { enabled: boolean }
```

渲染层 `window.agenticxDesktop.loadMobileEdgeStatus` / `saveMobileControlGrant`。

---

### Task 5: 底栏药丸

**Files:**

- Create: `desktop/src/components/MobileEdgeStatusPill.tsx`
- Modify: `desktop/src/components/SidebarAccountBar.tsx`：在 `AccountIdentityControl` 与 `ThemeToggleButton` 之间插入药丸
- Modify: `desktop/src/components/SidebarAccountBar.test.tsx`
- 若折叠顶栏也要身份区：只在 `SidebarAccountBar` 出现即可；`Topbar` 折叠态 **不要**再放一颗，避免双药丸

药丸样式（锁死）：

- 高度 28px，`rounded-full`，`px-2.5`，`text-[12px]`
- 边框 `border border-border`，背景 `bg-surface-card`
- 在线：8px 圆点 `bg-emerald-500`（这是状态色，不是新品牌主色）+ 文案 `手机`
- 离线但已授权：圆点 `bg-text-muted` + `手机 · 离线`（中间点是间隔点，不是 em dash）
- 未登录或 `controllable === false`：`return null`
- `:active { transform: scale(0.97) }`，transition 160ms ease-out
- `aria-label`：`手机控制：在线` / `手机控制：离线`

轮询 status：渲染进程每 5s `loadMobileEdgeStatus` 即可（主进程已 20s 心跳）。组件卸载 clearInterval。

点击：`useAppStore.getState().openSettings("mobile_control")`。

`SidebarAccountBar.test.tsx` 现状 mock 无 edge 状态，默认不应出现「手机」。新增用例把 mock 设为在线后 expect 包含「手机」。

---

### Task 6: 自测

```bash
cd desktop && npx vitest run src/components/settings/mobile-control/MobileControlTab.test.tsx src/components/SidebarAccountBar.test.tsx electron/mobile-edge-heartbeat.test.ts
```

若 vitest 配不包含 `electron/`，把测试放到 `desktop/src/utils/mobile-edge-heartbeat.test.ts` 并从 `mobile-edge.ts` 再导出纯函数，或把纯函数放 `desktop/src/utils/mobile-edge-heartbeat.ts` 供 main import。

改了 `main.ts` / preload 后必须完全重启 `npm run dev`（主进程不热更新）。计划实施者在说明里写清这一点。

浏览器工具不适用 Desktop；用 vitest + 若本机有 Near 窗口则手点开关。不要宣称「已在真机看过」除非确实看过。

---

## no-scope-creep

禁止改 SettingsPanel 里其它 Tab 内容。禁止「顺便」重排 TABS 顺序（只插入 mobile_control）。禁止改 `RunModePicker`。
