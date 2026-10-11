# 03 · portal 手机 H5：窄屏聊天 + 宿主选择

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: cursor-grok-4.6-xhigh-fast

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Master:** `.cursor/plans/pending/2026-09-07-mobile-edge-control-master.plan.md`  
**依赖:** 01 已合并。可与 02 并行。  
**Goal:** web-portal 在手机宽度可用：登录、对话、历史抽屉；输入区能选「云 / 我的电脑」。选电脑后发送必须被诚实拦住（Wave 1）。

**Architecture:** 不新建 app。改 `WorkspaceShell` / 设置壳 / `MachiChatView` 断点。宿主 sheet 为新组件，数据走 `/api/me/edge/*`。

**Tech Stack:** Next.js、`@agenticx/ui`、lucide-react、vitest；可选浏览器验证 390 宽。

---

## 实施前必读 skill（按序，不可跳）

1. `.agents/skills/redesign-existing-projects/SKILL.md`
2. `.agents/skills/emil-design-eng/SKILL.md`
3. `.agents/skills/apple-design/SKILL.md`（sheet / spring / safe-area / 可打断）
4. `.agents/skills/design-taste-frontend/SKILL.md` **只取反 slop 与对比度**；禁止落地页条款（hero、bento、换字体、新图标库）
5. Master 第 5 节

**Design Read：** 与 Master 第 5 节同一句。  
**Dials：** VARIANCE 3 / MOTION 4 / DENSITY 4。

这是产品聊天 UI，不是营销页。禁止 AI 紫光、三等分功能卡、Inter 替换、手绘 SVG 图标。

---

## In scope

- `WorkspaceShell` 窄屏：汉堡与顶栏不重叠、输入区不被键盘挡住
- `SettingsPanel` `<lg` 单栏（nav 改横向 chips）
- `ExecutionHostPicker` + 接入 `MachiChatView` `leftToolbar`
- Cookie presence 心跳
- i18n zh/en
- 单测 + 390 宽行为验收

## Out of scope

- Desktop / admin
- 真派发（05）
- 深度研究工作台重排、房间页专项、PWA
- 改 `enterprise/features/chat` 的 store 发送内核（只在 portal 的 `handleSend` 外包一层拦截）
- 改 `InputArea.tsx` 的发送热键逻辑（可用 `leftToolbar` 槽，不必改 InputArea）

---

## 根因与落点

| 问题 | 证据 |
|---|---|
| 侧栏抽屉已有，主区顶栏 `pl-14` 给汉堡留位 | `WorkspaceShell.tsx` L318–327、L607–616；`MachiChatView.tsx` L1002 `pl-14 lg:pl-6` |
| 设置死双栏 | `SettingsPanel.tsx` L230 `grid-cols-[240px_1fr]` |
| 输入区已有 `leftToolbar` | `MachiChatView.tsx` L844+；`InputArea.tsx` L14 |
| 电脑列表 API | 01：`GET /api/me/edge/computers`、`POST /api/me/edge/presence` |
| 登录页窄屏已单列 | `auth/page.tsx` 品牌区 `hidden lg:flex`，本 plan **不要改登录视觉** |

Wave 1 拦截文案（锁死）：

> 本机执行通道尚未开通，请改选云端后再发送。

localStorage 键：`agx-edge-host-v1`  
值：`cloud` 或 `computer:<deviceId>`

---

## 设计规格（实施时对照，禁止发挥）

### 宿主触发器（输入区左侧芯片）

- 高 28–32px，`rounded-full`，`px-2.5`，`text-xs`
- 图标 `Cloud` 或 `Monitor`（lucide，strokeWidth 1.8）
- 云：`云端`
- 电脑在线：绿点 8px + 电脑名截断（max 8 个汉字）
- 电脑离线：灰点 + `离线`
- `:active` `scale(0.97)` 160ms ease-out
- 触控热区至少 44px 高（芯片可视觉 32，外层 hit slop `py-1.5`）

### 宿主 sheet（仅 `<lg` 用底栏 sheet；`lg+` 用 origin-aware popover）

手机：

- 从底滑入，`padding-bottom: env(safe-area-inset-bottom)`
- 顶上 36px 拖拽条（4px 宽 36px 高的 pill，`bg-muted`）
- 标题：`任务在哪里运行`（不要「Choose where tasks run」英文当中文界面主标题；en locale 用 `Where tasks run`）
- 选项行高 ≥ 56px：左图标、标题、右绿/灰「在线/离线」、选中 `Check`
- 最后一行：`连接电脑` 为 muted 说明，不是假按钮成功。文案：`在 Near 桌面登录同一账号，并打开「允许手机控制这台电脑」。`
- 打开/关闭：200–320ms，`cubic-bezier(0.32, 0.72, 0, 1)` 或 spring bounce 0 / duration 0.3
- 跟手拖关闭：位移 1:1，松手速度 >0.11 或下拉过半则关
- `prefers-reduced-motion`：无位移，160ms opacity
- scrim `bg-black/40`，点击关闭；不要 `backdrop-blur` 整页糊死（命令面板教训）

桌面宽：popover `w-[min(calc(100vw-2rem),22rem)]`，`transform-origin` 对触发器，scale 0.96→1 + opacity，180ms `cubic-bezier(0.23, 1, 0.32, 1)`。

### 设置窄屏

- `<lg`：去掉 `grid-cols-[240px_1fr]`，改为 `flex flex-col`
- nav 改为横向 `overflow-x-auto` chips，不要 240px 侧栏
- 输入框 `w-[240px]` / `w-[320px]` 改为 `w-full max-w-full`

### 聊天窄屏

- 顶栏操作：分享/删除/token 在 `<sm` 收进 `MoreHorizontal` 菜单，避免与汉堡抢位
- composer 底部 `pb-[max(1rem,env(safe-area-inset-bottom))]`
- 保持 `h-[100dvh]`（WorkspaceShell 已有）

---

## FR / AC

- **FR-03-1** 390 宽能打开侧栏、新建对话、发送云消息、看回复区。
  - **AC-03-1** 浏览器 390 宽走通；或 Playwright/手动记录。至少对关键 class 做单测：设置壳 `<lg` 无 `grid-cols-[240px_1fr]`。
- **FR-03-2** 宿主选择写入 `agx-edge-host-v1`。
  - **AC-03-2** `enterprise/apps/web-portal/src/components/edge/execution-host.test.ts` 测 parse/serialize。
- **FR-03-3** 值为 `computer:*` 时 `handleSend` 不调用 `sendMessage`，展示锁定黄条。
  - **AC-03-3** 抽 `assertCloudHostOrExplain(host): { ok: true } | { ok: false; message }` 单测；`MachiChatView` 发送前调用。
- **FR-03-4** 电脑列表来自 GET computers；在线规则由服务端 `online` 字段决定，前端不重算 45s。
  - **AC-03-4** picker 测试 mock fetch。
- **FR-03-5** 进入 workspace 后每 30s POST presence（fingerprint 存 `agx-edge-mobile-fp-v1`）。
  - **AC-03-5** hook 单测用 fake timer：30s 触发第二次。
- **FR-03-6** 无桌面设备时 sheet 仍可开，仅云可选；「连接电脑」说明可见。
- **FR-03-7** zh/en 文案齐全，无 `—`。

---

### Task 1: 纯函数 + 失败测试

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/execution-host.ts`
- Create: `enterprise/apps/web-portal/src/lib/execution-host.test.ts`

```ts
export type ExecutionHost = { type: "cloud" } | { type: "computer"; deviceId: string };

export const HOST_STORAGE_KEY = "agx-edge-host-v1";
export const MOBILE_FP_KEY = "agx-edge-mobile-fp-v1";
export const COMPUTER_SEND_BLOCKED =
  "本机执行通道尚未开通，请改选云端后再发送。";

export function parseHost(raw: string | null): ExecutionHost { /* 非法值回 cloud */ }
export function serializeHost(host: ExecutionHost): string { /* cloud | computer:id */ }
export function assertSendableHost(host: ExecutionHost): { ok: true } | { ok: false; message: string } {
  if (host.type === "cloud") return { ok: true };
  return { ok: false, message: COMPUTER_SEND_BLOCKED };
}
```

非法 / 空 / `computer:` 无 id → `cloud`。

Run vitest 先红后绿。

---

### Task 2: presence hook

**Files:**

- Create: `enterprise/apps/web-portal/src/components/edge/useMobileEdgePresence.ts`
- Create: `enterprise/apps/web-portal/src/components/edge/useMobileEdgePresence.test.ts`

- fingerprint：localStorage `MOBILE_FP_KEY`，无则 `crypto.randomUUID()` 写入
- displayName：`navigator.userAgent` 截到 128 或固定 `手机浏览器`
- mount + 每 30s `POST /api/me/edge/presence`
- unmount 停止
- 401 不重试死循环（失败后该周期 skip）

在 `WorkspaceShell` 顶层调用一次，不要每个消息重挂。

---

### Task 3: ExecutionHostPicker

**Files:**

- Create: `enterprise/apps/web-portal/src/components/edge/ExecutionHostPicker.tsx`
- Create: `enterprise/apps/web-portal/src/components/edge/ExecutionHostPicker.test.tsx`
- Create: `enterprise/apps/web-portal/src/components/edge/useExecutionComputers.ts`（GET computers，15s 刷新）

实现必须遵守上文设计规格。列表空时不要假造「我的电脑 · 在线」。

选中后 `localStorage.setItem` + 关闭 sheet。

---

### Task 4: 接入 MachiChatView

**Files:**

- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`

1. `leftToolbar` 里 `ComposerPlusMenu` **旁边**加 `<ExecutionHostPicker />`，不要改 plus 菜单语义。
2. 读 host state（useState 初始化 `parseHost(localStorage...)`）。
3. 在现有 `handleSend` 最开头：

```ts
const gate = assertSendableHost(host);
if (!gate.ok) {
  setHostBlockMessage(gate.message);
  return;
}
setHostBlockMessage(null);
```

4. `hostBlockMessage` 用与 `visionWarning` 相同的 Alert 槽位展示（`MachiChatView.tsx` 约 L789–794），不要 toast 到边角。

**禁止**改 `enterprise/features/chat/src/store.ts` 的 `sendMessage`。

顶栏拥挤：`<sm` 把 token / 分享 / 删除收进一个 `DropdownMenu`（`@agenticx/ui` 已有）。汉堡占位 `pl-14` 保留。

composer 外层（约 L1180）`pb-6` 改为 `pb-[max(1.5rem,env(safe-area-inset-bottom))]`。

---

### Task 5: WorkspaceShell / Settings 窄屏

**Files:**

- Modify: `enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`
  - 已有 `mobileOpen` 抽屉，不要重写侧栏信息架构
  - 打开抽屉后点会话必须 `setMobileOpen(false)`（若尚未关）
- Modify: `enterprise/apps/web-portal/src/components/settings/SettingsPanel.tsx`
  - 外层：`grid-cols-1 lg:grid-cols-[240px_1fr]`（`<lg` 单栏）
  - nav：`flex flex-row overflow-x-auto lg:flex-col`，chip 上不要出现两行描述；`<lg` 隐藏 `tab.description`
  - 所有 `w-[240px]` / `w-[280px]` / `w-[320px]` 改为 `w-full max-w-full sm:max-w-[320px]`

不要重写设置各 Tab 业务逻辑。不要动模型服务保存 API。

---

### Task 6: i18n

**Files:**

- Modify: `enterprise/apps/web-portal/messages/zh.json` 的 `workspace` / `chat`
- Modify: `enterprise/apps/web-portal/messages/en.json` 对应 key

建议 key（名称锁死）：

```
workspace.hostCloud
workspace.hostComputer
workspace.hostOnline
workspace.hostOffline
workspace.hostSheetTitle
workspace.hostConnectHint
workspace.hostBlocked
```

`hostBlocked` 必须等于 `COMPUTER_SEND_BLOCKED` 中文；en：`On-device execution is not available yet. Switch to Cloud before sending.`

禁止文案出现外部产品名、仓库路径、`enterprise_edge_*`。

---

### Task 7: 验证

```bash
pnpm --filter @agenticx/web-portal exec vitest run \
  src/lib/execution-host.test.ts \
  src/components/edge/useMobileEdgePresence.test.ts \
  src/components/edge/ExecutionHostPicker.test.tsx
```

UI 验证（有浏览器工具就做，没有就写明未做）：

1. 390×844：登录（已有页）→ `/workspace` → 开菜单 → 新对话 → 发「hi」选云
2. 打开宿主 sheet，无电脑时只能选云
3. mock 或真有电脑时选电脑再发送，黄条出现且网络面板无新的 chat completions
4. 打开设置：无横向撑破、nav 可横滑
5. 聚焦输入，软键盘弹出后发送钮仍在视口内

`lg` 宽度回归：侧栏静态、设置恢复双栏、顶栏不进 More 菜单。

---

## no-scope-creep

禁止改 admin-console。禁止改 Desktop。禁止改深度研究面板布局。禁止把房间页做成第二套宿主选择。
