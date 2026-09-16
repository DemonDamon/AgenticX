# Desktop 安全中心 Tab：把散落的安全设置收成一处

Planned-with: Claude Opus 5
Suggested-Impl-Model: `cursor-grok-4.6-xhigh-fast`

> 本 plan 只做 **Desktop 设置界面的信息架构收敛**：新增「安全中心」Tab，把现在散在
> 六个 Tab 的安全设置迁进去，并补上后端已有、界面却没有入口的沙箱档位。
>
> **不改任何后端强制层。** 后端沙箱/权限强制已由
> `2026-08-25-mainline-port-command-sandbox-and-permissions.plan.md` 落地（分支
    10|> `feat/mainline-port-command-sandbox`，6 个 commit）。本 plan 只消费它的 API。
>
> 与 `2026-08-25-desktop-permission-ui-consolidation.plan.md`（词表收敛）**有冲突区**，
> 见 §0.3 的执行顺序，别两份同时改同一块 JSX。
>
> 实施前把本文件移到 `.cursor/plans/` 根目录，再从 `origin/main` 开分支。

---

## 0. 基线（不要依赖任何对话记忆）
    20|
动手前自己复核一遍，Desktop 每天在动。

| 项 | 值（2026-08-25 实测） |
|---|---|
| 目标分支 | `origin/main`（tip `db132f40`）或已合入沙箱 plan 的分支 |
| 后端前置 | `GET/PUT /api/permissions` 已返回 `command_permissions`、`shell_read_isolation`、`path_deny_enforcement`（`agenticx/studio/server.py` `get_permissions` L7499 / `put_permissions` L7536） |
| 沙箱档位取值 | `read-only` / `workspace-write`（默认） / `danger-full-access`（`agenticx/runtime/command_sandbox.py`） |
| 设置面板主文件 | `desktop/src/components/SettingsPanel.tsx`（11023 行） |
| Tab id 单一来源 | `desktop/src/settings-tab.ts` 的 `SETTINGS_TAB_IDS`（L2–L20）+ `SettingsTab`（L22）+ `isSettingsTab`（L24） |
    30|| 既有目录约定 | `desktop/src/components/settings/<area>/<Panel>.tsx`（已有 mcp / knowledge / voice / brains / connectors 等 25 个文件） |
| 共享开关组件 | `desktop/src/components/settings/SettingsSwitch.tsx`（**新文件用这个**；`SettingsPanel.tsx` L4902 有个同名局部实现，**不要动它、也不要去合并**） |
| 共享容器 | `Panel`（`./ds/Panel`）、`SettingsDropdown`（`./ds/SettingsDropdown`） |

复核命令：

```bash
cd desktop
grep -n "SETTINGS_TAB_IDS" -A 20 src/settings-tab.ts
grep -n "const TABS" -A 20 src/components/SettingsPanel.tsx
    40|grep -n "flushPermissions" src/components/SettingsPanel.tsx
curl -s --noproxy '*' "http://127.0.0.1:$(cat ~/.agenticx/serve.port)/api/permissions"
```

最后一条要能看到 `command_permissions` / `shell_read_isolation` / `path_deny_enforcement` 三个字段；看不到就是后端 plan 没合，先停下。

### 0.1 安全设置现在散在哪（迁移清单的依据）

| 现在的位置 | 内容 | 精确落点 |
|---|---|---|
    50|| 通用偏好 → Panel「权限」 | 执行确认下拉 + 凭据安全提示 | `SettingsPanel.tsx` L8909–L8938 |
| 通用偏好 → 权限高级 | 路径权限规则 / 命令拒绝列表 / 工具拒绝列表 | `PermissionsAdvancedPanel` L1592–L1958，使用点 L8939 |
| 通用偏好 → 桌面操控 | `computer_use.enabled` 开关 | `ComputerUseGeneralPanel` L4942–L5027，使用点 L8942 |
| 技能配置 → 技能高级设置 | 技能安全扫描（引擎版本 / 扫描模式 / 扫描已安装 / 忽略名单）、「未见高危则自动装完」 | `SkillAdvancedPanel` L5449–L5844，其中安全扫描区块 L5684–L5826、自动装完卡 L5677–L5683 |
| 钩子管理（独立 Tab） | 预置钩子 + 外部导入，含工具前置守卫 | `HooksTab` L1339–L1577，使用点 L10249 |
| 后端有、界面**完全没有** | 沙箱档位 `command_permissions`、平台能力两字段 | 本 plan Task 2 新建 |

### 0.2 明确**不迁**的（这不是遗漏，是有理由）

| 保留在原处 | 理由 |
|---|---|
    60|| 内置工具 → 「预授权工具」Panel（`ToolsTab` L2757） | 它是「这个工具存不存在 / 启不启用」，不是安全策略；且与 `toolsTabRef.saveAll()`（L7769）的 `tools_enabled` / `tools_options` 保存强耦合，搬走会把 bash 超时等无关项一起拖过来 |
| 远程连接 → Desktop token、CC Bridge Bearer token（`CcBridgeSettingsPanel` L1983） | 属连接配置，与 `CcBridgePanelHandle.save()` 保存链路绑定 |
| MCP → 市场安装前置校验 | 属 MCP 安装流程，不是常驻策略 |
| 定时任务 → 自动化行为开关 | 属 Automation |

安全中心里对「预授权工具」只保留**一句跨引用**（现有 L1862 已有类似写法），不复制控件。同一控件出现在两个 Tab 必然分叉。

### 0.3 与姊妹 plan 的冲突区与执行顺序

`2026-08-25-desktop-permission-ui-consolidation.plan.md`（词表收敛）的 Task 2 要改**通用偏好的权限区** JSX——正是本 plan 要整体搬走的那块。两份同时做必然冲突。

    70|**顺序：本 plan 先整份做完，姊妹 plan 再整份做。不要交错。**

1. **本 plan 全部 Task**——纯搬家 + 新增沙箱档位区块。
2. **姊妹 plan 全部 Task**——在安全中心的新位置上做词表统一、文案与审批作用域。

定这个顺序的依据（实测，可自行复核）：

```bash
cd desktop
grep -rn "ConfirmStrategyDropdown\|CONFIRM_MODE_OPTIONS" src/   # 只在 SettingsPanel.tsx
grep -rn "confirmStrategy" src/                                  # store / command-registry / ChatView / ChatPane / App 都有
```

- 执行确认下拉**只有设置页在用**，所以搬它是纯位置变更，零行为风险。
- 但 `confirmStrategy` 的取值（`manual` / `semi-auto` / `auto`）散在 `store.ts` L545/L1094、`core/command-registry.ts` L71、`ChatView.tsx` L2517、`App.tsx` L545/L2490 各自映射标签——统一词表要动这五处，还要迁移旧 localStorage 取值。
- 两件事爆炸半径差一个量级。**同一个 commit 里既搬位置又改语义，review 时分不清哪个改动导致的回归。**

因此本 plan 的硬约束：**行为不变的重构**。搬进新 Tab 的每一块，逻辑与文案**逐字保留**，取值集合一个不改。唯一的新增行为是「工作区隔离」区块（Task 2），它是全新能力，不与既有控件重叠。

若实施者拿到的是姊妹 plan 已经做完的分支，则本 plan 的搬家以那份结果为输入，**不要回退它的文案与词表改动**。

---
    80|
## In scope / Out of scope

### In scope

- 新增 Tab id `security`（`settings-tab.ts` + `TABS`）
- 新增目录 `desktop/src/components/settings/security/`，含 Tab 外壳与各区块
- 迁入（原位置删除，不留重复控件）：执行确认 + 凭据提示、路径 / 命令 / 工具拒绝、桌面操控、技能安全扫描 + 未见高危自动装完、钩子管理整体
- 新增「工作区隔离」区块：沙箱档位选择 + `shell_read_isolation` / `path_deny_enforcement` 如实措辞
- 新增纯函数模块 `desktop/src/utils/sandbox-status.ts` + 单测
    90|- 移除独立「钩子管理」Tab，并为 `openSettings("hooks")` 保留 deep-link 别名

### Out of scope（严禁顺手做）

- **禁止**改任何后端文件。`agenticx/` 下 diff 必须为空
- **禁止**碰 `agenticx/studio/server.py`（尤其顶部 import 区块）
- **禁止**新增「网络安全 / 安全网关 / 传输加密 / 内置运行时」类区块——仓库没有对应强制层，做了就是假开关
- **禁止**把「沙箱」做成设置里可常驻关闭的总开关（见 §1.2 的立场）
- **禁止**把 macOS TCC 类系统授权（完全磁盘访问 / 辅助功能 / 自动化）塞进本 Tab：那是向 OS 要更多权，与给子进程收权方向相反，同屏会让用户以为授权后就没有隔离
- **禁止**迁移 §0.2 表里那四项
   100|- **禁止**合并或重写 `SettingsPanel.tsx` L4902 的局部 `SettingsSwitch`（新文件直接用 `settings/SettingsSwitch.tsx`）
- **禁止**改 `confirmStrategy` 的取值集合（`manual` / `semi-auto` / `auto`）、`store.ts` 的该字段、`core/command-registry.ts` L71 的 `confirmStrategyLabel`、`ChatView.tsx` L2517 的 `confirmModeLabel`、`App.tsx` 的相关映射——词表统一归姊妹 plan
- **禁止**在搬家过程中改任何被搬走代码的逻辑或文案（除本 plan 明确列出的标题改名与长段说明删除）
- **禁止**改 `ContextUsagePopup.tsx`、Pro/Lite 双入口组件、`enterprise/`
- **禁止**删除任何既有组件文件（`HooksTab` 是从 `SettingsPanel.tsx` 内**剪出**到新文件，不是删文件）

---

## Task 1：新建安全中心 Tab，迁入权限三块与执行确认

**修改：** `desktop/src/settings-tab.ts`、`desktop/src/components/SettingsPanel.tsx`
**新增：** `desktop/src/components/settings/security/SecurityCenterTab.tsx`、`desktop/src/components/settings/security/PermissionsAdvancedPanel.tsx`

   110|### 1.1 Tab id

`settings-tab.ts` 的 `SETTINGS_TAB_IDS` 里加 `"security"`。**位置**：放在 `"general"` 之后（安全中心是高频、与通用偏好相邻）。

`SettingsPanel.tsx` L1043 的 `TABS` 同步加一项：

```ts
{ id: "security", label: "安全中心", icon: ShieldCheck },
```

`ShieldCheck` 从 `lucide-react` 导入（该文件已大量使用 lucide 图标，沿用同一 import 语句）。

   120|### 1.2 这个 Tab 的叙事顺序（不许打乱）

区块自上而下：

1. **工作区隔离**（Task 2 新建）——先说 OS 边界，因为它始终在
2. **执行确认**——再说什么时候问你
3. **文件访问**（路径规则）
4. **命令执行**（命令拒绝名单）
5. **工具权限**（工具拒绝名单）
6. **桌面操控**（Task 3）
   130|7. **技能安全**（Task 3）
8. **钩子守卫**（Task 4）

理由写进代码注释（一句即可）：确认框不是安全边界，OS 隔离才是；所以隔离在最上面，确认在其后。顺序反了会让用户以为「点了批准就没有隔离」。

### 1.3 迁移 `PermissionsAdvancedPanel`

把 `SettingsPanel.tsx` L1580–L1958 整段（含 `PathRule`、`RegistryToolRow`、`PermissionsAdvancedPanelHandle`、组件本体）**剪切**到新文件 `settings/security/PermissionsAdvancedPanel.tsx`：

- 组件内部逻辑**逐字保留**，只改 import 路径（`Panel` → `../../ds/Panel`，`useAppStore` 按新文件相对路径）
- `resolveApiBase`（L1605–L1610）是组件内局部 `useCallback`，跟着走，不要抽公共
- `export type PermissionsAdvancedPanelHandle` 与 `export const PermissionsAdvancedPanel` 都要导出
   140|- `SettingsPanel.tsx` 改为 `import { PermissionsAdvancedPanel, type PermissionsAdvancedPanelHandle } from "./settings/security/PermissionsAdvancedPanel";`，并删掉 L159 附近若有的重复 re-export（先 grep 确认有没有别处 import 这个 handle 类型）

三个 Panel 标题按 §1.2 改名（这是本 plan 的信息架构改动，不是顺手改文案）：

| 原标题 | 新标题 |
|---|---|
| 路径权限规则 | 文件访问 |
| 命令拒绝列表 | 命令执行 |
| 工具拒绝列表 | 工具权限 |

面向终端用户的长段策略说明按主线偏好**删掉**（如 L1755 的「按 glob 模式匹配…首个命中生效」、L1815 的「fnmatch 模式匹配…」）。保留一句短说明即可，用户会自行感知。**但 L1861 那句「命中后直接拒绝、不会再弹确认」必须留**——它说的是 deny 与确认闸的优先级，是语义而不是废话。
   150|
### 1.4 迁移执行确认与凭据提示

把 L8909–L8938 的 Panel「权限」内容搬进 `SecurityCenterTab`：

- 「执行确认」+ `ConfirmStrategyDropdown`（`SettingsPanel.tsx` L363–L380）与 `CONFIRM_MODE_OPTIONS`（L356–L362）一并搬。已 grep 确认二者**只被设置页使用**，所以这是纯位置变更
- `confirmStrategy === "auto"` 时的黄色警示条（L8922–L8927）一并搬，文案不变（它已经明确说了高风险仍会询问，符合「不过度承诺」）
- 「凭据安全」小节（L8928–L8937）一并搬

`confirmStrategy` / `onConfirmStrategyChange` 目前是 `SettingsPanel` 的 props/state，**通过 props 传给 `SecurityCenterTab`**，不要在新组件里另建一份 state（两处 state 必然分叉）。

> **取值不许动。** `CONFIRM_MODE_OPTIONS` 的 `manual` / `semi-auto` / `auto` 三个取值、label 与顺序**逐字保留**。把它们换成 `ask` / `allowlist` / `auto` 是姊妹 plan 的事，那需要同时改 `store.ts`、`core/command-registry.ts` L71、`ChatView.tsx` L2517、`App.tsx` 并迁移旧 localStorage——**不要在搬家的 commit 里顺手做**。

### 1.5 保存链路（**最容易踩的坑，必须照做**）
   160|
`SettingsPanel.tsx` L8472–L8473 有一条注释：GENERAL TAB **保持挂载**（非激活时 `hidden`），目的就是让窗口底部「保存」能通过 `permissionsPanelRef.current?.flushPermissions?.()`（L7756）刷入权限 API，而不是只依赖输入框失焦。

所以新 Tab **必须同样保持挂载**：

```tsx
{/* === SECURITY TAB ===（保持挂载：底部「保存」需 flushPermissions，勿改为条件渲染） */}
<div className={tab === "security" ? "space-y-4" : "hidden"}>
  <SecurityCenterTab ref={securityTabRef} confirmStrategy={confirmStrategy} onConfirmStrategyChange={onConfirmStrategyChange} />
</div>
```

   170|`SecurityCenterTab` 用 `forwardRef` + `useImperativeHandle` 暴露：

```ts
export type SecurityCenterTabHandle = {
  /** 转发内部 PermissionsAdvancedPanel 的 flushPermissions，供窗口底部「保存」统一触发。 */
  flushPermissions: () => Promise<{ ok: boolean; error?: string }>;
};
```

`SettingsPanel.tsx`：
- L6314 的 `permissionsPanelRef` 改为 `securityTabRef = useRef<SecurityCenterTabHandle>(null)`
   180|- L7756 改为 `await securityTabRef.current?.flushPermissions?.()`，**错误提示文案与 confirm 分支逻辑（L7757–L7765）一字不改**

> 若把新 Tab 写成 `{tab === "security" && ...}` 条件渲染，用户在别的 Tab 点「保存」时 `flushPermissions` 会静默变成 no-op，路径/命令/工具拒绝列表**丢失且无任何报错**。这正是 L8472 那条注释在防的事。

### 1.6 通用偏好瘦身

从 L8909–L8942 移除：Panel「权限」、`<PermissionsAdvancedPanel />`、`<ComputerUseGeneralPanel />`（后者在 Task 3 迁）。

**保留在通用偏好**：`WebSearchSettingsPanel`、`SuggestedQuestionsSettingsPanel`、`SessionMemoryPanel`、工作目录、用户档案 / 元智能体档案等——它们不是安全设置。

### AC-1
   190|
1. `cd desktop && npx tsc --noEmit` → 0 error。
2. 左侧导航出现「安全中心」，点进去能看到执行确认 + 文件访问 / 命令执行 / 工具权限三块。
3. 通用偏好里这四块**已消失**，且 `grep -n "PermissionsAdvancedPanel" src/components/SettingsPanel.tsx` 只剩 import 与新 Tab 内的使用点。
4. **保存链路手测（必做）**：在安全中心加一条路径规则 → 切到「模型服务」Tab → 点底部「保存」→ 重开设置，规则仍在。
5. `grep -rn "flushPermissions" src/` 在 `SettingsPanel.tsx` 与 `SecurityCenterTab.tsx` 之外零命中。

---

## Task 2：新增「工作区隔离」区块（沙箱档位 + 如实上报平台差异）
   200|
**新增：** `desktop/src/utils/sandbox-status.ts`、`desktop/src/utils/sandbox-status.test.ts`、`desktop/src/components/settings/security/WorkspaceIsolationPanel.tsx`

### 2.1 立场（实施者必须理解，不是照抄）

后端默认把每个 shell 子进程关在工作区里；`danger-full-access` 不是「关掉沙箱」这种一劳永逸的开关——后端在该档位下**每次执行仍会要求确认**（`_apply_command_sandbox` 强制 `host_full_access` 确认）。所以界面上：

- **不要**做成「沙箱安全」总开关（ON/OFF）。那会让用户以为一键就能静默直跑
- 档位是三选一的下拉，`danger-full-access` 项的说明**必须**写出「每次执行仍会询问」
- 沙箱不可用时后端会降级为要求确认、不静默执行。界面不需要为此做开关，但**不能**宣称「始终隔离」

   210|### 2.2 纯函数模块 `sandbox-status.ts`

```ts
export type SandboxTier = "read-only" | "workspace-write" | "danger-full-access";

/** 唯一档位词表。label 中文，description 一句话，不得过度承诺。 */
export const SANDBOX_TIER_OPTIONS: ReadonlyArray<{
  value: SandboxTier;
  label: string;
  description: string;
}>;

   220|/** 后端字段缺失/未知一律回落 workspace-write（与后端 normalize_command_permissions 对齐）。 */
export function normalizeSandboxTier(raw: unknown): SandboxTier;

export type SandboxNotice = { id: string; tone: "info" | "warn"; text: string };

/**
 * 把平台能力两字段翻成用户看得懂的话。
 * 必须返回**多条**，禁止合成一句——三平台说同一句话必然有一个在过度承诺。
 */
export function sandboxNotices(input: {
  shellReadIsolation?: unknown;   // "full" | "none"
   230|  pathDenyEnforcement?: unknown;  // "full" | "partial" | "none"
}): SandboxNotice[];
```

`sandboxNotices` 的判定表：

| 输入 | 必须表达 | tone |
|---|---|---|
| `shellReadIsolation === "full"` | 工作区之外的文件读不到 | `info` |
| `shellReadIsolation === "none"` | **工作区之外的文件仍可被读取**（当前 Windows） | `warn` |
| `pathDenyEnforcement === "full"` | 拒绝规则完整生效 | `info` |
   240|| `pathDenyEnforcement === "partial"` | 拒绝规则**仅部分生效**，并说明原因：平台限制，或规则条数超过上限（后端上限 512） | `warn` |
| 任一为 `"none"` / 缺失 / 无法识别 | 按**最保守**解读，`warn`，明确说「无法确认」 | `warn` |

档位文案（逐字审）：

| value | label | description 必须表达 |
|---|---|---|
| `read-only` | 只读 | 不允许写任何文件 |
| `workspace-write` | 仅工作区可写（默认） | 只能写工作区与本次临时目录 |
| `danger-full-access` | 脱离隔离 | **明确说出每次执行仍会要求确认** |

   250|> `danger-full-access` 的 label 不许写成「完全访问」「关闭沙箱」这类听起来一劳永逸的词。

**颜色纪律**：用主题层 token（`text-status-warning`、`text-text-faint` 等），不要硬编码 hex；`info` 不要用刺眼红。

### 2.3 `WorkspaceIsolationPanel`

- 读：复用 `GET /api/permissions`（同一份响应里就有三个字段）。**不要**新开 IPC——`PermissionsAdvancedPanel` 已有 `resolveApiBase` 的写法，照同一模式（未配置远程 URL 时用 `window.agenticxDesktop.getApiBase()`）
- 写：`PUT /api/permissions` 只提交 `{ command_permissions }`，后端会忽略未知 key
- 展示 `sandboxNotices()` 的每一条，一行一条
- 档位切换后给即时反馈（保存成功 / 失败透出底层错误），失败不要静默

### AC-2
   260|
新增 `desktop/src/utils/sandbox-status.test.ts`：

1. `normalizeSandboxTier(undefined)` / `""` / `"weird"` → `"workspace-write"`；三个合法值原样返回。
2. `SANDBOX_TIER_OPTIONS` 长度 3、`value` 无重复、每项 `description` 非空。
3. `SANDBOX_TIER_OPTIONS` 里 `danger-full-access` 项的 `description` 含「确认」二字（**这条断言防止文案退回一劳永逸的承诺**）。
4. `sandboxNotices({ shellReadIsolation: "none" })` 至少一条 `tone === "warn"`，且文本含「工作区之外」。
5. `sandboxNotices({ pathDenyEnforcement: "partial" })` 文本含「部分」。
6. `sandboxNotices({})`（字段缺失）返回非空且全部 `tone === "warn"`（保守解读）。
7. `sandboxNotices({ shellReadIsolation: "full", pathDenyEnforcement: "full" })` 返回 **≥2 条**（证明没被合成一句）。
   270|
```bash
cd desktop && npx vitest run src/utils/sandbox-status.test.ts
```

手测：`curl` 本机 `/api/permissions` 看到 macOS 是 `full` / `full`，界面应显示两条 `info`；把响应临时改成 `none` / `partial`（改后端返回或用 devtools 断点）应出现两条 `warn`。

---

## Task 3：迁入桌面操控与技能安全扫描

**修改：** `desktop/src/components/SettingsPanel.tsx`
   280|**新增：** `desktop/src/components/settings/security/ComputerUsePanel.tsx`、`desktop/src/components/settings/security/SkillGuardPanel.tsx`

### 3.1 桌面操控

把 `ComputerUseGeneralPanel`（L4942–L5027）整段剪到 `settings/security/ComputerUsePanel.tsx`，重命名为 `ComputerUsePanel`：

- 内部逻辑逐字保留（`loadComputerUseConfig` / `saveComputerUseConfig` IPC 不变，保存成功后那段「需完全退出 Near 重开」的说明保留——它是真实约束）
- `SettingsSwitch` 改为 `import { SettingsSwitch } from "../SettingsSwitch";`（共享组件），**不要**从 `SettingsPanel.tsx` 导出局部那个
- 删除 L8942 的使用点，改在 `SecurityCenterTab` 渲染

### 3.2 拆 `SkillAdvancedPanel`
   290|
`SkillAdvancedPanel`（L5449–L5844）现在把三件事混在一个 Panel：技能三件套 / 学习（trinity）、安装策略、安全扫描。只把**安全**那两块搬走。

好消息：逻辑已经在 hooks 里，搬家是 JSX 切分，不是逻辑重写：

| hook | 位置 | 归属 |
|---|---|---|
| `useTrinityConfig` | L5083 | **留在** Skills（学习 / 三件套），**同时** SkillGuardPanel 也要用（见下） |
| `useSkillInstallPolicy` | L5155 | 迁 → 安全中心 |
| `useGuardSettings` | L5234 | 迁 → 安全中心 |

   300|把这两段 JSX 剪到 `SkillGuardPanel.tsx`：

- 「未见高危则自动装完」`SettingsToggleCard`（L5677–L5683，用 `useSkillInstallPolicy`）
- 「技能安全扫描」整块（L5684–L5826：引擎版本 / 扫描模式 / 扫描已安装技能 / 结果卡 / 已忽略名单）
- `policyMessage`、`guardMessage`、`scanMsg`、`guardFixMsg`、`restoreMsg` 的展示（L5755–L5774、L5835–L5841 中属于这两块的部分）
- `runGuardFixInMetaAgent`（L5494–L5543）跟着走：它依赖 `form.skill_manage_enabled`（trinity）、`addPane`、`setForwardAutoReply`、`closeSettings`
- `GuardScanResultCard`（L5928）与 `GUARD_PATTERN_LABELS`（L5893）、`GUARD_PATTERN_LABEL_HIGH_ENTROPY`（L5914）、`guardVerdictLabel`（L5916）、`formatGuardSnapshotTs`（L5920）：先 `grep` 确认只被这块用；只被这块用就一起搬，否则留在原处并导出

**耦合处理（必须照做）：** AI 修复要求「允许助手改本地技能」（`form.skill_manage_enabled`，trinity）已开启，否则给提示（L5496–L5499）。`SkillGuardPanel` 在新文件里**再调一次 `useTrinityConfig()`** 读这个布尔值即可——那个 hook 每次调用各自拉取，不共享 state；**开关本体仍留在技能配置页**，安全中心只读它、不复制开关。若提示文案里写了「上方」（L5497 的「请先在上方开启」），改成「技能配置页」，否则跨 Tab 之后指代错误。

   310|`useTrinityConfig` 需要 export（现在是文件内局部 `function`）。它留在 `SettingsPanel.tsx` 并加 `export`，新文件 import——**不要**为此新建 hooks 文件，那会牵动 Skills 页无关代码。

留在技能配置页的：`SkillsTab` + `SkillAdvancedPanel`（现在只剩 trinity / 学习相关）。若剪完后 `SkillAdvancedPanel` 的标题「技能高级设置」已不含安全项，标题不用改（它仍是高级设置）。

### AC-3

1. `npx tsc --noEmit` → 0 error。
2. 技能配置页**不再**出现「技能安全扫描」与「未见高危则自动装完」；安全中心出现它们。
3. 手测扫描链路未坏：安全中心点「扫描已安装技能」能出结果卡；对一条结果点「AI 修复」（需先在技能配置页开启「允许助手改本地技能」）能创建 Meta 会话并关闭设置面板。
4. 未开启「允许助手改本地技能」时点 AI 修复，提示文案指向**技能配置页**（不是「上方」）。
   320|5. 桌面操控开关在安全中心可切换并落盘（`grep computer_use ~/.agenticx/config.yaml`）。

---

## Task 4：迁入钩子管理，移除独立 Tab

**修改：** `desktop/src/settings-tab.ts`、`desktop/src/components/SettingsPanel.tsx`
**新增：** `desktop/src/components/settings/security/HooksSection.tsx`

### 4.1 为什么整块搬

钩子的语义就是「在 agent 行为前后插入拦截」，`tool:before_call` 上的 `pre_tool_guard` 是拦危险 shell 的那一层。把「守卫钩子」单拎出来会导致同一份 `/api/hooks` 数据在两个 Tab 都能编辑——那是本 plan 要消除的病，不是要制造的。
   330|
### 4.2 怎么搬

把 `HooksTab`（L1339–L1577）连同**只被它使用**的模块级常量剪到 `HooksSection.tsx`：

- `HOOK_PRIMARY_CONFIG_PATH`（L1284）、`HOOK_PRESETS`（L1286）、`hookSourceBadge`（L1291）、`hookTypeBadge`（L1314）、`EVENT_LABELS`（L1330）
- 搬之前逐个 `grep -n "<名字>" src/` 确认没有别处引用；有引用就留在原处并导出，**不要**两边各留一份

组件改名 `HooksSection`，内部 JSX 逐字保留（含预置钩子为主区、外部导入折叠的既有信息架构——那是主线已确认的偏好，不要重做）。

在 `SecurityCenterTab` 中以可折叠 `Panel` 承载，**默认折叠**（它是整个 Tab 里最长的一块，展开会把上面七个区块挤走）：

   340|```tsx
<Panel title="钩子守卫" collapsible defaultCollapsed>
  <HooksSection />
</Panel>
```

### 4.3 移除独立 Tab 与 deep-link 别名

- `SettingsPanel.tsx` L1043 的 `TABS` 里删掉 `{ id: "hooks", label: "钩子管理", icon: Anchor }`（L1055）
- 删掉 L10248–L10249 的 `{tab === "hooks" && <HooksTab />}`
- `settings-tab.ts` 的 `SETTINGS_TAB_IDS` **保留** `"hooks"`（别删，它是 `isSettingsTab` 的校验源，删了会让外部 `openSettings("hooks")` 静默失效）
- 在 `SettingsPanel.tsx` 消费 `settingsOpenToTab` 的 effect（L6322–L6326）里加一次别名归一：`hooks` → `security`
   350|

```ts
// 钩子管理已并入安全中心；旧 deep-link 仍要能打开到正确分区。
const TAB_ALIASES: Partial<Record<SettingsTab, SettingsTab>> = { hooks: "security" };
```

当前 `grep -rn 'openSettings("hooks")' src/` 为**零命中**，所以这层别名是为外部/历史调用留的保险，不是修某个现存 bug。

### AC-4

1. `npx tsc --noEmit` → 0 error；`npx vitest run` 全绿。
   360|2. 左侧导航**没有**「钩子管理」；安全中心底部有「钩子守卫」可折叠区块，默认折叠。
3. 展开后钩子的增删改查、按事件展开、外部导入折叠区都能用（手测至少一次启停）。
4. `useAppStore.getState().openSettings("hooks")`（devtools 里执行）能打开设置并落在安全中心。
5. `grep -rn "HooksTab" src/` 零命中（已改名为 `HooksSection`）。

---

## Task 5：收口验证与提交

### 5.1 测试

```bash
   370|cd desktop
npx vitest run src/utils/sandbox-status.test.ts src/utils/confirm-scope.test.ts
npx tsc --noEmit
npm run build
```

期望：全绿、0 error、build 成功。main 已有的 `confirm-scope.test.ts` / `ConfirmDialog.test.tsx` **一条都不许因本 plan 变红**。

### 5.2 手测清单（改了设置面板必做）

完全退出 Near（⌘Q）后 `npm run dev` 重开——只刷新渲染进程可能拿到旧的 `dist-electron`。
   380|
| 项 | 期望 |
|---|---|
| 左侧导航 | 有「安全中心」，无「钩子管理」 |
| 安全中心区块顺序 | 工作区隔离 → 执行确认 → 文件访问 → 命令执行 → 工具权限 → 桌面操控 → 技能安全 → 钩子守卫 |
| 工作区隔离 | macOS 下显示两条 `info`；档位切到「只读」后重开设置仍是只读 |
| 跨 Tab 保存 | 安全中心加规则 → 切 Tab → 底部「保存」→ 重开仍在（Task 1 AC-4） |
| 通用偏好 | 不再有权限 / 桌面操控区块，其余项（网页搜索、建议问题、会话记忆、工作目录）完好 |
| 技能配置 | 不再有安全扫描；学习 / 三件套仍可用 |
| 端到端 | 在聊天里 `cat ~/.agx-read-probe` 仍被拒（证明只改了界面，没动强制层） |

### 5.3 提交分组
   390|
```
feat(desktop): gather security settings into one center
feat(desktop): expose the workspace isolation tier and platform limits
refactor(desktop): move skill scanning and hook guards into the security center
```

一个 Task 一个 commit 也可以，但 Task 1 必须最先（其他都依赖新 Tab 骨架）。

trailer（顺序固定，只许这五个）：

```
   400|Plan-Id: 2026-08-25-desktop-security-center-tab
Plan-File: .cursor/plans/2026-08-25-desktop-security-center-tab.plan.md
Plan-Model: Claude Opus 5
Impl-Model: cursor-grok-4.6-xhigh-fast
Made-with: Damon Li
```

若实际实施换了模型，`Impl-Model` 以实际使用为准，不要照抄本行。

subject/body **禁止**出现客户名、第三方产品名，以及「对齐 X / 对标 X / X-style / inspired by X」这类对标措辞。改动动机只写本产品行为变化。
   410|
---

## 总验收

| ID | 断言 |
|---|---|
| AC-G1 | 安全设置只在安全中心一处可编辑；`grep` 不到重复控件 |
| AC-G2 | 沙箱档位在界面可改并落盘；`danger-full-access` 文案说出每次仍需确认 |
| AC-G3 | 平台能力两字段分别成句，未被合成一句 |
| AC-G4 | 字段缺失时按最保守解读展示，不假设 `full` |
   420|| AC-G5 | 跨 Tab 点底部「保存」仍能刷入路径/命令/工具拒绝列表 |
| AC-G6 | 钩子的增删改查未退化；旧 deep-link 落到安全中心 |
| AC-G7 | 技能扫描与 AI 修复链路未退化；跨 Tab 指代文案已修正 |
| AC-G8 | `git diff --stat origin/main..HEAD -- agenticx/` 为空（未碰后端） |
| AC-G9 | `git diff --stat origin/main..HEAD -- enterprise/` 为空 |
| AC-G10 | `npx tsc --noEmit`、`npx vitest run`、`npm run build` 全绿 |
| AC-G11 | 无「网络安全 / 安全网关 / 传输加密 / 内置运行时」类无强制层的假开关 |
| AC-G12 | 无任何组件文件被删除（剪切到新文件不算删除） |
| AC-G13 | 除「工作区隔离」新区块外，本 plan 是**行为不变的重构**：`confirmStrategy` 取值集合未变，被搬走的代码逻辑与文案未改 |

---
   430|
## 已知限制（验收时不得粉饰）

1. **钩子管理含非安全事件**（`sessionStart` 等），归入安全中心是命名上的妥协。取舍理由：钩子的主要用途是拦截 agent 行为，拆成两处会造成同一数据双入口编辑，那个代价更大。
2. **工具权限仍分两处**：拒绝名单在安全中心，启用 / 预授权在内置工具页。理由见 §0.2——预授权与 `tools_enabled` 保存链路耦合。安全中心用一句跨引用说明，不复制控件。
3. **Windows 没有读隔离**，本 plan 只让界面不再隐瞒（`shell_read_isolation === "none"` 时明说），不修它。
4. **`partial` 的降级原因目前只有两类**（平台限制 / 规则条数超上限）。后端将来加新原因，文案要跟着扩，不要写死成两句。
5. **`SettingsPanel.tsx` 仍然很大**。本 plan 剪出约 700 行到 `settings/security/`，但没有整体拆分该文件——那是独立的重构，不在本 plan 范围。
6. **token / 凭据未收进来**。Desktop token 与 CC Bridge token 仍在远程连接页，属连接配置；若将来要做「凭据与访问」分区，需另起 plan 处理保存链路。
