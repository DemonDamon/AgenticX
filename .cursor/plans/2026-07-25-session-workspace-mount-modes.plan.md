# 会话工作区三态挂载模式与沙箱边界收口

Planned-with: Opus 5
Suggested-Impl-Model: 见「子规划与推荐模型」表

---

## 背景与问题

Near Desktop 侧栏「文件管理 → 添加文件（软链）/ 添加文件夹（软链）」当前的实现是：在会话的
default 工作区里为用户选择的源路径创建 symlink，不复制、不挂第二根目录。

这个设计把两种完全不同的用户意图压到了同一个入口上：

1. 「让 agent 看看这个文件」——只需要读，不应该有任何写入面。
2. 「让 agent 在这份代码上干活」——需要写，但产出必须可控地回到真实位置。

用 symlink 同时实现这两件事，导致会话工作区不再是一个边界，而是一组指向真实磁盘的指针。

### 根因证据链（不依赖对话上下文，实施者可自行复核）

**证据 1 — 软链创建处没有 realpath 校验。**
`desktop/electron/main.ts:10959-11037` 的 `link-into-session-workspace` handler：

```ts
// main.ts:10995-11011
const resolvedSource = path.resolve(source);
if (
  resolvedSource === defaultResolved ||
  resolvedSource.startsWith(defaultResolved + path.sep)
) {
  continue;
}
const name = uniqueLinkName(defaultDir, source, usedNames);
const dest = path.join(defaultDir, name);
await fs.promises.symlink(resolvedSource, dest, st.isDirectory() ? "dir" : "file");
```

`path.resolve` 只做字符串规范化，不解析 symlink。若 `defaultDir` 自身路径中含有符号链接
（macOS 上 `/tmp` → `/private/tmp` 即是典型），前缀判断会得出错误结论。

**证据 2 — Python 侧工作区沙箱在 Desktop 模式下整段关闭。**
`desktop/electron/main.ts:2732` 启动 `agx serve` 时固定注入环境变量
`AGX_DESKTOP_UNRESTRICTED_FS: "1"`。而 `agenticx/cli/agent_tools.py:2809-2842` 的
`_resolve_workspace_path`：

```python
# agent_tools.py:2811-2815
if _desktop_unrestricted_fs_enabled():
    if raw_path.is_absolute():
        return raw_path.resolve(strict=False)
    return (_workspace_root() / raw_path).resolve(strict=False)
```

即 `file_read` / `file_write` / `bash_exec` / `liteparse` 在 Desktop 下对任意绝对路径放行。
换言之当前**没有生效中的文件系统沙箱**，软链只是其中一条穿透路径，不是唯一一条。

**证据 3 — taskspace 读取层有意允许 outbound symlink。**
`agenticx/studio/session_manager.py:2966-2987` 的 `_resolve_inside_root` 文档字符串明写
"without treating outbound symlinks as escape"，containment 是词法的（只拦 `..`），
`list_taskspace_files`（`session_manager.py:1567-1606`）用 `entry.stat()` 跟随 symlink。
现存测试 `tests/test_taskspace_symlink_resolve.py` 固化了这一行为。

**证据 4 — Windows 上软链会静默失败。**
`main.ts:11014-11023` 两次 `fs.promises.symlink` 都失败时只 `console.warn`，handler 仍返回
`{ ok: true, linked: 0 }`；`WorkspacePanel.tsx:794-807` 的 `linkSourcesIntoDefault` 只判断
`result.ok`，不看 `linked`，于是 UI 表现为「添加成功但工作区是空的」。
Windows 创建 symlink 需要开发者模式或管理员权限，目录应使用 `junction`。

**证据 5 — 遍历跟随 symlink 且无深度限制。**
`session_manager.py:1567-1606` 的 `list_taskspace_files` 逐层 `iterdir()`，`entry.stat()`
跟随链接。若被链目录内部存在指回上层的链接，UI 逐层展开会构成环；若链接的是大仓库，
`node_modules` / `.git` 会被完整暴露给目录列举与后续入库。

### 目标形态

按用户意图拆成三种挂载模式，每种有明确且互不重叠的权限语义：

| 模式 | 语义 | 落盘形态 | 写权限 |
|---|---|---|---|
| `reference`（默认） | 只读引用 | 不落盘，仅记录绝对路径 | 无 |
| `copy` | 沙箱工作副本 | 复制进会话隔离目录 | 可写副本，回写需 diff 确认 |
| `link` | 直连原目录 | symlink（现状） | 直接写真实路径，UI 显式高危标记 |

---

## In scope / Out of scope

**In scope**

- `desktop/electron/main.ts` 中会话工作区相关 IPC 的 realpath 校验与 Windows junction 修复。
- 新增挂载模式数据模型、持久化与 Desktop UI 三态入口。
- `copy` 模式的复制、变更检测与 diff 回写闸门。
- 以 root 白名单替代 `AGX_DESKTOP_UNRESTRICTED_FS=1` 的一刀切放行。
- 目录遍历的 symlink 不跟随、深度与条目数限制、悬空链接标记。
- 上述各项的单元与冒烟测试。

**Out of scope（明确不许动）**

- 不重构 `WorkspacePanel.tsx` 的布局、样式、终端嵌入、右键菜单等与本需求无关的部分。
- 不改动 `agenticx/studio/server.py` 顶部 import 区块（该文件 import 极其敏感，见 AGENTS.md）。
- 不改动 `@file` chip 的注入交互与 `reference-attachment.ts` 的 key 生成规则。
- 不引入容器 / VM / seccomp 等 OS 级隔离，本 plan 只做进程内路径边界。
- 不改动 `materialize-session-attachments` 的聊天附件落盘语义（P0 只补校验，不改行为）。
- 不做知识库入库侧的过滤策略调整。

**no-scope-creep 边界**：每个改动必须能对应到下面某一条 FR。看到顺手可优化的代码一律不动。

---

## 子规划与推荐模型

| 子规划 | 性质 | 推荐模型 | 理由 |
|---|---|---|---|
| P0 路径硬化 | 主进程 + Python 双侧安全收口，序列敏感 | gpt-5.6-terra-medium | 跨栈、高回归风险，需要强推理确认边界不被绕过 |
| P1 挂载模式数据模型 | 后端 CRUD + 类型定义，样板为主 | composer-2.5-fast | 结构清晰、改动机械 |
| P2 Desktop 三态 UI | 前端交互与视觉 | claude-opus-5-thinking-low | 涉及高危操作的确认交互与视觉分级，需要审美与分寸 |
| P3 copy 模式与 diff 回写 | 后端逻辑密集 | gpt-5.6-sol-medium | 文件状态机与冲突处理，逻辑复杂但不涉视觉 |
| P4 关闭 unrestricted FS | 高风险收口 | gpt-5.6-terra-medium | 一旦过严会破坏现有工具链，需谨慎 |

以上仅为建议，最终 `Impl-Model` trailer 以实际使用为准。

---

## P0：路径硬化（先做，可独立交付）

这一阶段不引入新概念，只把现有软链路径上的高危点补齐。即便后续 P1-P4 不做，P0 也应单独有价值。

### FR-0.1 统一 realpath 校验工具

**落点**：新建 `desktop/electron/path-guard.ts`。

导出两个函数：

```ts
/** Canonicalize a path, tolerating a non-existent leaf. */
export async function safeRealpath(p: string): Promise<string>;

/** True when `child` is `root` or lives under it, after both are canonicalized. */
export async function isRealpathUnder(child: string, root: string): Promise<boolean>;
```

`safeRealpath` 的实现要点：对不存在的叶子节点，逐级向上找到最近的存在祖先做
`fs.promises.realpath`，再把剩余段拼回去（`fs.realpath` 对不存在路径会抛 `ENOENT`，
不能直接用）。`isRealpathUnder` 必须比较 canonicalized 后的值，并用
`child === root || child.startsWith(root + path.sep)` 判定，禁止裸 `startsWith`
（否则 `/a/bc` 会被误判在 `/a/b` 下）。

**改造点**：`main.ts:10995-11003`，把现有的

```ts
const resolvedSource = path.resolve(source);
if (resolvedSource === defaultResolved || resolvedSource.startsWith(defaultResolved + path.sep))
```

换成 `await isRealpathUnder(source, defaultDir)`。`defaultResolved` 的计算
（`main.ts:10973`）同步改为 `await safeRealpath(defaultDir)`。

**AC-0.1**：新增 `desktop/electron/__tests__/path-guard.test.ts`，至少覆盖：
- `/a/bc` 不在 `/a/b` 下（前缀误判）。
- 软链 `X -> /a/b` 时，`X/c` 判定为在 `/a/b` 下。
- 叶子不存在时 `safeRealpath` 不抛异常且返回规范化祖先 + 剩余段。
- macOS 上 `/tmp/foo` 与 `/private/tmp/foo` 判定为同一路径。

### FR-0.2 Windows junction 与失败上报

**落点**：`main.ts:11006-11023` 的 symlink 创建块。

改动意图：目录在 `process.platform === "win32"` 时用 `"junction"` 类型；两次尝试都失败时
把该源路径收集到 `failed: string[]` 一并返回，而不是只 `console.warn`。返回结构从
`{ ok, defaultDir, homeDir, linked, created }` 扩展为额外带 `failed`。

**落点**：`desktop/src/components/WorkspacePanel.tsx:794-807` 的 `linkSourcesIntoDefault`。

改动意图：`result.ok` 为真但 `linked === 0` 或 `failed.length > 0` 时，不得走成功分支
（不清空 `errorText`、不关闭 `showAddForm`），而是 `setErrorText` 展示具体失败原因，
包含失败的路径数量与首个路径。Windows 权限失败时文案要可执行，例如
「创建软链需要开启 Windows 开发者模式或以管理员身份运行」。

**AC-0.2**：
- `desktop/electron/__tests__/link-workspace.test.ts` 断言 win32 平台下目录调用参数为 `"junction"`。
- 断言 symlink 全部抛错时返回的 `failed.length === sources.length` 且 `linked === 0`。
- 手工验收：在 Windows 未开发者模式下点「添加文件夹（软链）」，UI 必须显示失败原因而非静默成功。

### FR-0.3 遍历不跟随 symlink，限深度与条目数

**落点**：`agenticx/studio/session_manager.py:1567-1606` 的 `list_taskspace_files`。

改动意图：`entry.stat()` 改为 `entry.lstat()` 判定类型（返回结构中已有 `is_symlink` 字段，
保持不变）；对每次列举增加 `max_entries`（默认 2000）截断，超出时在返回体里带
`truncated: true` 与 `total_seen`。不改变单层 `iterdir()` 的既有语义，即不引入递归。

同时对 symlink 条目补一个 `dangling: bool` 字段：`entry.is_symlink() and not entry.exists()`。

**落点**：`WorkspacePanel.tsx` 的 `loadDir`（`425-437` 行附近）与文件行渲染。

改动意图：`dangling` 为真的条目以弱化色 + 「源已失效」提示渲染，点击时给出明确错误文案
而不是透传 `ENOENT`。`truncated` 为真时在列表底部展示「仅显示前 N 项」。

**AC-0.3**：
- 新增 `tests/test_taskspace_list_symlink_guard.py`：构造 `root/link -> /tmp/target`，
  断言返回条目 `is_symlink is True`；删除 target 后断言 `dangling is True` 且列举不抛异常。
- 断言目录含 3000 个条目时返回 `truncated is True` 且 `len(files) == 2000`。
- 现存 `tests/test_taskspace_symlink_resolve.py` 必须继续通过（P0 不改变读取放行语义）。

---

## P1：挂载模式数据模型

### FR-1.1 taskspace 条目增加 mount_mode

**落点**：`agenticx/studio/session_manager.py` 的 taskspace 元数据结构与
`_resolve_taskspace_path`（`2827-2831`）附近的持久化逻辑。

新增字段 `mount_mode: Literal["reference", "copy", "link"]`，缺省值 `"link"`
（向后兼容既有数据，历史条目就是软链）。同时记录 `source_path: str`（原始绝对路径）
与 `linked_at: float`。

**落点**：`agenticx/studio/server.py:5349-5437` 的 `/api/taskspace/workspaces` 系列 REST。
在响应体中透出 `mount_mode` 与 `source_path`。

**严禁**：不得触碰 `server.py` 顶部 import 区块；改动只在上述路由函数体内进行，
逐行确认没有误删相邻无关代码（参见 AGENTS.md 中关于该文件的强制约束）。

**AC-1.1**：
- `tests/test_taskspace_mount_mode.py`：新建 reference/copy/link 三种条目后
  `GET /api/taskspace/workspaces` 各自回显正确 `mount_mode`。
- 读取一份不含 `mount_mode` 的历史元数据文件，断言默认回落为 `"link"`。

### FR-1.2 IPC 契约扩展

**落点**：`desktop/electron/main.ts:10959` 的 `link-into-session-workspace`；
`desktop/electron/preload.ts` 与 `desktop/src/global.d.ts` 中对应的类型声明。

payload 从 `{ sessionId, sources }` 扩展为 `{ sessionId, sources, mode?: MountMode }`，
`mode` 缺省 `"link"` 以保持 `ensure-artifact-taskspaces.ts:151-156` 现有调用不变。

**AC-1.2**：`desktop/src/utils/ensure-artifact-taskspaces.ts` 不传 `mode` 时行为与改动前
逐字节一致（现有 artifact 链接测试全绿）。

---

## P2：Desktop 三态 UI

### FR-2.1 添加入口改为三选一

**落点**：`WorkspacePanel.tsx:1770-1795` 的上下文菜单（当前两项「添加文件（软链）」
「添加文件夹（软链）」）。

改动意图：菜单项改为「添加文件」「添加文件夹」，选择路径后弹出模式选择，三个选项分别是：

- **引用（只读）** — 副标题「agent 只能读取，不会改动你的文件」，默认选中。
- **工作副本** — 副标题「复制一份到会话隔离目录，改动需你确认后才回写」。
- **直连原目录** — 副标题「agent 的改动会直接写入 <源路径>」，用 danger 色，
  需要用户二次点击确认。

文案不得出现「软链」「symlink」这类实现细节；用户看到的是权限语义。

### FR-2.2 列表内模式标识

**落点**：`WorkspacePanel.tsx` 文件行渲染。

每个顶层条目按 `mount_mode` 展示一个轻量 badge：引用用中性色、工作副本用信息色、
直连用警示色。badge 样式必须走主题 token（`--ui-*` / `text-text-*` / `bg-surface-*`），
禁止硬编码颜色值。

**AC-2.1 / AC-2.2**：
- 手工验收：三种模式各添加一次，列表 badge 与实际 `mount_mode` 一致。
- 在 dark / dim / light 三态主题下 badge 均有足够对比度。
- 选择「直连原目录」时必须出现二次确认，且确认弹窗为应用内主题化弹窗
  （或 Electron `dialog` 配应用图标），不得使用原生 `window.confirm`。

---

## P3：copy 模式与 diff 回写

### FR-3.1 复制落盘

**落点**：`main.ts` 新增 IPC `copy-into-session-workspace`（与 link handler 同级，
建议紧邻其后，约 11038 行）。

行为：把源复制到 `<default>/<uniqueName>`，同时把源的 canonical 路径、复制时刻的
mtime / size 清单写入 `<default>/.agx-copy-manifest.json`。目录复制要跳过
`.git`、`node_modules`、`.venv`、`__pycache__`，并设总大小上限（默认 200MB）与
文件数上限（默认 5000），超限时不复制并返回可读原因。

### FR-3.2 变更检测与回写闸门

**落点**：`main.ts` 新增 IPC `diff-session-workspace-copy` 与 `apply-session-workspace-copy`。

- `diff-*`：对照 manifest 计算副本内的新增 / 修改 / 删除清单，并检测源在此期间
  是否也发生了变化（源 mtime 与 manifest 记录不一致 → 标记 `source_drifted`）。
- `apply-*`：仅在用户确认后执行；`source_drifted` 为真时必须先向用户暴露冲突，
  禁止静默覆盖。

**落点**：`WorkspacePanel.tsx` 工作副本条目的右键菜单增加「查看改动并回写」。

**AC-3.1 / AC-3.2**：
- `desktop/electron/__tests__/workspace-copy.test.ts`：复制目录后修改副本内一个文件，
  断言 diff 结果 `modified` 含该文件、`added` / `deleted` 为空。
- 复制后在源侧改动同名文件，断言 `source_drifted is true`。
- 断言超过大小上限时返回 `{ ok: false }` 且错误文案含具体上限数值。
- 断言 `.git` / `node_modules` 未被复制。

---

## P4：关闭 unrestricted FS，改为 root 白名单

这是收益最大也最容易造成回归的一步，必须放在最后，且单独一个 commit 以便回滚。

### FR-4.1 以白名单替代一刀切放行

**落点**：`desktop/electron/main.ts:2732`，移除 `AGX_DESKTOP_UNRESTRICTED_FS: "1"`。

**落点**：`agenticx/cli/agent_tools.py:198-277` 的 `_session_workspace_roots`。

改动意图：roots 集合需要额外纳入本会话中 `mount_mode` 为 `link` 的条目的
**canonical 源路径**（否则 P4 落地后直连模式立刻失效）。`reference` 模式的源路径
只加入「可读 root」，不加入「可写 root」——即需要把单一 roots 列表拆成
`read_roots` 与 `write_roots` 两组。

**落点**：`agent_tools.py:280-285` 的 `_is_path_under_root`。

改动意图：`Path.resolve()` 已会解析 symlink，语义上够用，但要显式处理 `resolve` 对
不存在路径的行为差异（`strict=False` 下不解析不存在段的 symlink）。补一个与
FR-0.1 同语义的 Python 侧实现，并在 `_resolve_workspace_path`
（`agent_tools.py:2809-2842`）中对 write 类调用使用 `write_roots`。

**落点**：`agent_tools.py:3987+` 的 `_tool_file_write`、`3249+` 的 `_bash_exec_prepare`。
写路径校验切到 `write_roots`。

### FR-4.2 敏感目录黑名单

**落点**：`agent_tools.py:2765-2770` 的 `_is_protected_config_path` 附近，扩展为
`_is_protected_path`，在现有 `~/.agenticx/config.yaml` 基础上增加
`~/.ssh`、`~/.aws`、`~/.gnupg`、`~/.agenticx/serve.token`、
`~/.agenticx/wechat_credentials.json`、`~/.agenticx/feishu_binding.json`。
黑名单对读与写都生效，且优先级高于任何 root 白名单。

**AC-4.1 / AC-4.2**：
- `tests/test_workspace_root_enforcement.py`：未挂载的绝对路径 `file_write` 抛
  `path escapes workspace`；`reference` 模式源路径 `file_read` 成功但 `file_write` 被拒；
  `link` 模式源路径读写均成功。
- 断言 `~/.ssh/id_rsa` 在任何模式下 `file_read` 均被拒。
- 冷启动验收（强制门槛）：`agx serve --host 127.0.0.1 --port <临时端口>` 启动不崩溃，
  且 `/api/session`、`/api/avatars`、`/api/sessions`、`/api/taskspace/workspaces`
  均返回 200。
- 回归验收：现有会话中用 `@file` 引用工作区外文件后提问，模型仍能读到内容
  （即 `reference` 的读路径没有被 P4 误伤）。

---

## 实施顺序与提交切分

建议五个 commit，每个独立可回滚，各自跑完对应 AC 后再进入下一个：

1. `fix(desktop): harden session workspace path resolution` — P0
2. `feat(studio): add mount_mode to taskspace metadata` — P1
3. `feat(desktop): three-state workspace mount UI` — P2
4. `feat(desktop): sandboxed workspace copies with diff gate` — P3
5. `feat(core): replace unrestricted desktop fs with root allowlist` — P4

每个 commit 须带 trailer：

```
Plan-Id: 2026-07-25-session-workspace-mount-modes
Plan-File: .cursor/plans/2026-07-25-session-workspace-mount-modes.plan.md
Plan-Model: <规划模型>
Impl-Model: <实施模型>
Made-with: Damon Li
```

---

## 风险与回滚

- **P4 过严导致工具链断裂**是最大风险。缓解：P4 单独 commit；`_session_workspace_roots`
  在拒绝路径时的报错必须包含「当前允许的 roots 列表」，便于用户与开发者判断是漏挂载
  还是真越权。
- **现存测试 `tests/test_taskspace_symlink_resolve.py` 固化了 outbound symlink 放行**。
  P0 不动它；P4 若需要调整该行为，必须同步更新该测试并在 commit body 说明语义变更。
- **`ensure-artifact-taskspaces.ts` 依赖默认 link 行为**。P1 的 `mode` 默认值必须是
  `"link"`，任何把默认值改成 `"reference"` 的做法都会让 agent 产物在工作区里失联。
