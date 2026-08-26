# 输入区运行模式 pill（权限档位常驻入口）

Planned-with: Claude Opus 5
Suggested-Impl-Model: `cursor-grok-4.6-xhigh-fast`

> 理由：单文件新增组件 + 一处接线，无跨栈风险，但要对齐既有 pill 的视觉密度与主题 token，
> 需要一点前端品味，不适合最便宜的样板档。

---

## 0. 背景与根因（不依赖对话记忆）

用户目前**只能在设置面板里**看到与修改运行模式（权限档位）。对话进行中、Agent 正在动手时，
界面上没有任何地方显示「我现在处于哪一档」，用户无法在动手前快速收紧或放开权限。

同类产品（多家）都把这个档位做成输入区底部的常驻 pill，与「运行位置」并列。本 plan 在
Machi Desktop 补上这个入口。

### 前置条件（已满足，实施前请自行核对）

| 依赖 | 状态 | 落点 |
|---|---|---|
| 唯一模式词表 `RUN_MODE_OPTIONS` | **已存在** | `desktop/src/constants/confirm-strategy-options.ts` L15–L31 |
| store 权威字段 `runMode` / `setRunMode` | **已存在** | `desktop/src/store.ts` L546、L635、L1098、L1406 |
| 应用内主题化确认弹窗 | **已存在** | `window.agenticxDesktop.confirmDialog`（用法见 `RunLocationPicker.tsx` L95–L106） |

核对命令：

```bash
cd desktop
grep -n "RUN_MODE_OPTIONS" src/constants/confirm-strategy-options.ts
grep -n "runMode\|setRunMode" src/store.ts
```

三条都有输出才开始实施。任何一条为空，说明前置 plan 未落，**停下问用户**，不要自己造词表。

---

## In scope / Out of scope

### In scope

- 新增 `desktop/src/components/composer/RunModePicker.tsx`
- 在 `ChatPane.tsx` 输入区底部接线，**常驻显示**（不受 `isBrandEmptyState` 约束）
- 升到 `auto` 档时的二次确认弹窗
- 组件单测

### Out of scope（严禁顺手做）

- **禁止**新增任何模式枚举、常量或类型。档位一律从 `RUN_MODE_OPTIONS` 读，
  `RunMode` 类型从 `confirm-strategy-options.ts` 导入
- **禁止**改 `desktop/src/store.ts` 的 `runMode` 语义、默认值或持久化逻辑（只读它、只调 `setRunMode`）
- **禁止**改 `RunLocationPicker.tsx` 与 `WorkspaceFolderPicker.tsx` 的任何现有行为
- **禁止**改设置面板的权限区（那是另外两份 plan 的地盘）
- **禁止**碰后端 `agenticx/runtime/confirm.py` 或 `/api/permissions`
- **禁止**把 `isBrandEmptyState` 那一排整体改成常驻（会挤压对话区，用户已明确否决）
- **禁止**碰 `enterprise/`

---

## Task 1：新增 `RunModePicker` 组件

**新建：** `desktop/src/components/composer/RunModePicker.tsx`

### 1.1 结构照抄 `RunLocationPicker`

`desktop/src/components/composer/RunLocationPicker.tsx`（167 行）是同族 pill 的既有实现，
**整体结构直接复用**，保证两个 pill 视觉与交互完全一致：

| 复用点 | RunLocationPicker 行号 |
|---|---|
| `panelStyle(rect)` 定位函数 | L12–L18 |
| `syncPosition` + `useLayoutEffect` 重排监听 | L39–L55 |
| 点击外部 / Esc 关闭 | L57–L73 |
| trigger button 的 className | L114–L116 |
| `createPortal` 下拉面板 className | L132–L137 |
| 选项行 className + `Check` 勾选 | L138–L148 |

差异只有三处：`panelStyle` 的 `width` 从 200 改为 **260**（三档描述文字更长）、
图标随档位变化、选中项要多渲染一行 `description`。

### 1.2 档位 → 图标映射

用 `lucide-react`（项目已依赖）：

```ts
import { Check, ChevronDown, Hand, ShieldCheck, Zap } from "lucide-react";

const RUN_MODE_ICON: Record<RunMode, typeof Hand> = {
  ask: Hand,
  allowlist: ShieldCheck,
  auto: Zap,
};
```

### 1.3 trigger 视觉

```tsx
<button
  ref={anchorRef}
  type="button"
  className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors ${
    mode === "auto" ? "text-amber-500" : "text-text-subtle"
  } ${open ? "bg-surface-hover" : "hover:bg-surface-hover hover:text-text-primary"}`}
  onClick={() => setOpen((v) => !v)}
  aria-haspopup="listbox"
  aria-expanded={open}
  title={currentOption.description}
>
  <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
  <span className="truncate">{currentOption.label}</span>
  <ChevronDown className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
</button>
```

**颜色纪律：** `auto` 用 `text-amber-500`（警示但非错误），**不要用红色**——红色留给真正的错误态。
其余两档用 `text-text-subtle`，与 `RunLocationPicker` 一致。禁止硬编码 hex。

### 1.4 下拉面板

遍历 `RUN_MODE_OPTIONS` 渲染三行，每行：图标 + `label`（13px，`text-text-primary`）+
下方 `description`（11px，`text-text-faint`）+ 命中当前档时右侧 `Check`。

结构参照 `WorkspaceFolderPicker.tsx` L508–L527 的双行选项写法（label 一行、路径一行），
把「路径」那一行换成 `description`。

### 1.5 升档确认

选中 `auto` 且**当前不是** `auto` 时，先弹确认，用户确认后才 `setRunMode("auto")`：

```ts
const applyMode = async (next: RunMode) => {
  setOpen(false);
  if (next === mode) return;
  if (next !== "auto") {
    setRunMode(next);
    return;
  }
  const dlg = await window.agenticxDesktop.confirmDialog({
    title: "切换到低风险自动执行？",
    message: "低风险操作将不再逐条询问，直接在当前工作目录内执行。",
    detail: "高风险操作（删除、覆盖、外发数据等）仍会请求你确认。",
    confirmText: "切换",
    cancelText: "取消",
  });
  if (dlg.confirmed) setRunMode("auto");
};
```

**文案纪律（逐字审）：**

- **不许**写「无需询问」「不受限制」「全部自动执行」——后端确实会拦高风险，这些说法是不实承诺
- `detail` 必须出现「高风险」字样，这是 AC-1.4 的断言点
- **不要**加「我已了解风险」复选框式的强制勾选：用户点第二次就变肌肉记忆，安全收益归零、只剩摩擦

降档（`auto` → 其他）**不弹确认**——收紧权限不需要确认。

### 1.6 降级处理

`window.agenticxDesktop.confirmDialog` 不可用时（`typeof !== "function"`），
**不要静默切到 auto**，直接 return 并保持原档位（fail-closed，与后端一致）。

### AC-1

新增 `desktop/src/components/composer/RunModePicker.test.tsx`（vitest + @testing-library/react，
项目已有同类测试可参照 `desktop/src/components/ConfirmDialog.test.tsx`）：

1. 默认渲染时 trigger 文本等于 `runModeLabel(store.runMode)`。
2. 点开后出现 3 个 `role="option"` 或等价选项行，文案分别等于 `RUN_MODE_OPTIONS` 的 `label`。
3. 选中非 `auto` 档时**不调用** `confirmDialog`，且 `setRunMode` 被调用一次。
4. 选中 `auto` 时调用 `confirmDialog`，且传入的 `detail` 字符串包含「高风险」。
5. `confirmDialog` 返回 `{ confirmed: false }` 时 `setRunMode` **未**被调用。
6. `window.agenticxDesktop.confirmDialog` 为 `undefined` 时选 `auto`，`setRunMode` **未**被调用。

```bash
cd desktop && npx vitest run src/components/composer/RunModePicker.test.tsx
```

---

## Task 2：接入 ChatPane 输入区

**修改：** `desktop/src/components/ChatPane.tsx`（唯一改动点，约 L13517–L13522）

### 现状

```tsx
{isBrandEmptyState ? (
  <div className="mt-1.5 flex min-w-0 items-center gap-1 px-0.5">
    <RunLocationPicker />
    <WorkspaceFolderPicker api={composerWorkspace} />
  </div>
) : null}
```

整排仅空态渲染。权限档位**必须常驻**——用户最需要看到「我现在是什么权限」的时刻恰恰是
对话进行中、Agent 正在动手时。

### 改法

保持这一排的容器**始终渲染**，只让 `RunLocationPicker` 与 `WorkspaceFolderPicker` 维持空态条件：

```tsx
<div className="mt-1.5 flex min-w-0 items-center gap-1 px-0.5">
  {isBrandEmptyState ? <RunLocationPicker /> : null}
  <RunModePicker />
  {isBrandEmptyState ? <WorkspaceFolderPicker api={composerWorkspace} /> : null}
</div>
```

**顺序固定为 运行位置 → 运行模式 → 工作目录。** 权限紧跟运行位置，因为权限语义强依赖
「本地还是远程」；工作目录是可选项，排最后不打断主线。

顶部 `import` 加一行（**不要**用 inline import，遵守 `no-inline-imports` 规则）：

```ts
import { RunModePicker } from "./composer/RunModePicker";
```

放在既有的 `RunLocationPicker` import（L53）相邻位置。

> **`server.py` 级别的编辑纪律同样适用于本文件：** `ChatPane.tsx` 超过 13000 行，
> 编辑时**只能精确增删目标行**，禁止整段替换覆盖相邻无关代码。改完对照 `git diff`
> 逐行确认没有误删任何与本需求无关的既有代码。

### AC-2

1. `cd desktop && npx tsc --noEmit` → 0 error。
2. `git diff --stat` 中 `ChatPane.tsx` 的改动行数 **< 12 行**（超出说明动了不该动的地方）。
3. 手测：启动 Desktop（`npm run dev`），
   - 新建空会话 → 底部同排可见「本地 / 运行模式 / 选择文件夹」三个 pill；
   - 发出第一条消息后 → 运行位置与文件夹消失，**运行模式 pill 仍在**；
   - 切到 `auto` → 弹出主题化确认弹窗（不是系统 `window.confirm`），确认后 pill 变 amber；
   - 重启应用 → 档位与设置面板显示一致。
4. 多窗格：两个窗格的 pill 显示一致（`runMode` 是全局字段，不是 per-pane，本 plan 不改这一点）。

---

## Task 3：与设置面板的一致性回归

**不改代码**，只验证 Task 1–2 没有引入第二套真相。

### AC-3

1. `cd desktop && grep -rn "每次询问\|白名单放行\|低风险自动执行" src/ | grep -v confirm-strategy-options.ts`
   → 只应命中测试文件，**不得**命中 `RunModePicker.tsx`（证明文案是从词表读的，没有硬编码）。
2. 在设置面板改档位 → 输入区 pill 立刻同步（同一个 store 字段）。
3. 在输入区 pill 改档位 → 打开设置面板显示一致。
4. `cd desktop && npx vitest run` → 全绿，既有断言一条未改。

---

## 提交分组

```
feat(desktop): surface the run mode as a persistent composer control
```

trailer（顺序固定，只许这五个）：

```
Plan-Id: 2026-08-26-composer-run-mode-pill
Plan-File: .cursor/plans/2026-08-26-composer-run-mode-pill.plan.md
Plan-Model: Claude Opus 5
Impl-Model: <以实际使用为准，未确认时问用户>
Made-with: Damon Li
```

subject / body 禁止出现第三方产品名与「对齐 X / 对标 X」类措辞——只写本产品的行为变化。

---

## 总验收

| ID | 断言 |
|---|---|
| AC-G1 | 运行模式 pill 在空态与非空态**都**可见 |
| AC-G2 | pill 文案 100% 来自 `RUN_MODE_OPTIONS`，无硬编码档位文字 |
| AC-G3 | 升到 `auto` 有应用内主题化二次确认，降档无确认 |
| AC-G4 | 确认弹窗 `detail` 明说高风险仍会询问，全文无「无需询问 / 不受限制」类措辞 |
| AC-G5 | `confirmDialog` 不可用时不会切到 `auto`（fail-closed） |
| AC-G6 | 设置面板与 pill 双向同步，无第二套状态 |
| AC-G7 | `npx tsc --noEmit` 与 `npx vitest run` 全绿 |
| AC-G8 | `git diff` 无文件删除，`ChatPane.tsx` 改动 < 12 行 |

---

## 已知限制（验收时不得粉饰）

1. **`runMode` 目前是全局字段，不是 per-pane。** 多窗格下改一处会影响全部窗格。这与
   「模型选择按窗格独立」的既有偏好不一致，但改成 per-pane 涉及 store 结构与持久化迁移，
   超出本 plan 范围。若用户需要，另开 plan。
2. **pill 只反映前端 store 的档位，不校验后端是否真按该档执行。** 后端强制层是姊妹 plan 的范围。
3. **远程模式下的权限语义与本地不同**（沙箱边界在远端），本 plan 的 pill 不区分这一点，
   文案对两种运行位置说同一句话。补齐需依赖 `/api/permissions` 的平台能力字段，属安全中心 plan。
