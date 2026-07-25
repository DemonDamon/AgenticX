# 产物自动挂载导致沙箱写权限被提权（引用父目录下的子文件被自动直连）

Planned-with: Opus 5
Suggested-Impl-Model: cursor-grok-4.5-high-fast（前端 utils 纯函数 + Electron 主进程 IPC 守卫，改动面小但属安全边界收口，需要能自行推演「谁在什么时刻触发了挂载」的因果链；不建议交给弱模型，因为错改会直接放大或反向锁死写权限）

## 现象

用户在会话 `3ad013e9-a301-424f-b11b-199e9cde480d` 的工作区文件列表里，看到 `requirements.txt` 带着「直连」badge，而它的父目录 `research-agent` 是「引用」。用户判断这是「一开始是引用、中间过程变成直连」的 bug。

结论：**不是同一条 mount 记录被原地改 mode**，`requirements.txt` 从落地起就是 `link`。但**确实是 bug，而且比 badge 不一致更严重**——一次被沙箱拒绝的写操作，反而让系统自动授予了该文件的写权限，第二次重试就成功了。这是一条权限提升（privilege escalation）路径。

## 根因（证据链，不依赖对话记忆）

### 事实证据

`~/.agenticx/taskspaces/3ad013e9-a301-424f-b11b-199e9cde480d/default/.agx-mounts.json` 按 `linked_at` 排序：

| 时间 | mode | name | source_path |
|---|---|---|---|
| 09:41:53 | `reference` | research-agent | `/Users/damon/myWork/research-agent` |
| 09:42:07 | `reference` | codecoze-ResearchAgent | `/Users/damon/myWork/codecoze-ResearchAgent` |
| **21:46:17.560** | **`link`** | **requirements.txt** | `/Users/damon/myWork/research-agent/requirements.txt` |

`requirements.txt` 在该文件里只有这一条记录，`mode` 自始为 `link`；同名 symlink 的 `birthtime` 也是 `21:46:17`。

`~/.agenticx/sessions/3ad013e9-a301-424f-b11b-199e9cde480d/messages.json` 精确到毫秒的顺序：

| idx | 时间 | 内容 |
|---|---|---|
| 137 | 09:43:06 | user：`在 @/Users/damon/myWork/research-agent/requirements.txt 插入一个torch的版本依赖` |
| 142 | **21:46:17.045** | tool `file_edit`，`tool_status: error`，`ERROR: path escapes workspace: /Users/damon/myWork/research-agent/requirements.txt` |
| — | **21:46:17.560** | `.agx-mounts.json` 写入 `requirements.txt` / `mode: link` |
| 144 | 21:46:22.400 | tool `file_edit`，`tool_status: done`，`OK: edited /Users/damon/myWork/research-agent/requirements.txt` |

**关键时序**：挂载发生在**失败的** `file_edit`（142）之后约 515ms，在**成功的** `file_edit`（144）之前约 5s。所以触发挂载的不是「写成功后同步产物」，而是**那次被拒绝的写尝试本身**。515ms 与 `WorkPanel` 的 400ms 防抖吻合。

### 代码链路（当前 `main` @ `434c105d`）

1. `desktop/src/components/work-panel/WorkPanel.tsx:789-820`：`artifactSyncKey` 变化后 400ms 防抖，调 `ensureArtifactTaskspacesForSession(sid, paths, …)`。
2. `desktop/src/utils/session-artifacts.ts:340-346`：tool 行只要 `toolName` 是 `file_write` / `file_edit`，就**无条件**取 `toolArgs.path` 作为产物路径——**完全不看 `toolStatus`**（`Message.toolStatus` 存在，见 `desktop/src/store.ts:237`，此处未读取）：

```ts
if (toolName === "file_write" || toolName === "file_edit") {
  const argPath = String(message.toolArgs?.path ?? "").trim();
  if (argPath) addPath(paths, seen, argPath);   // ← 失败/被拒绝的写也会进来
```

3. `desktop/src/utils/session-artifacts.ts:279-310`（`agentMessageRowsToCollectorMessages`）：从 assistant 的 `tool_calls` 里合成 tool 行，只要函数名是 `file_write` / `file_edit` 就产出路径。这是**纯意图**，此刻连工具结果都还不存在，同样无法反映成败。
4. `desktop/src/utils/ensure-artifact-taskspaces.ts:156`：`await linker({ sessionId: sid, sources: paths })` —— **不传 `mode`**。
5. `desktop/electron/main.ts:10997-11001`：IPC 默认 `mode = "link"`。
6. `desktop/electron/main.ts:11039-11049`：虽有「禁止把已有 reference/copy 静默升级为 link」的守卫，但 `findMountForSource`（`desktop/electron/workspace-mounts.ts:83-94`）只比较**完全相同的 source_path** 或**同名 basename**，`requirements.txt` 与既有 `research-agent` 两者都不匹配 → 判定为「无既有挂载」，于是新建一条顶层 `link`。
7. `agenticx/cli/agent_tools.py:279-288`：`mode == "link"` 的 mount 其 `source_path` 被加入**可写根**（`_add(source_path, writable=True)`），而 `reference` 只进只读根。于是同一绝对路径的第二次 `file_edit` 通过。

### 一句话根因

**沙箱拒写 → 这次拒写被当成「产物」采集 → 自动挂载器以默认 `link` 把它挂成直连 → 写权限被授予 → 重试成功。** 安全边界被自己的产物同步逻辑绕过。

### 第二个静默 link 调用点

`desktop/src/components/WorkspacePanel.tsx:1200-1203` 的预览兜底同样不传 `mode`，即「仅为预览一个文件」也会拿到直连写权限。本 plan 只把它显式化并留待后续处理（见 Out of scope）。

### 已验证的安全前提（决定 FR-2 可行）

把自动挂载降级为 `reference` **不会**破坏产物列表与预览：

- `agenticx/studio/session_manager.py:1663-1703`：root 列举时会为没有文件系统实体的 `reference` 挂载注入虚拟行（含 `dangling` / `source_path`）。
- `agenticx/studio/session_manager.py:1728-1765`：`read_taskspace_file` 对 `reference` 挂载走 `source_path` 解析并正常返回内容。

## In scope

- `desktop/src/utils/session-artifacts.ts`：产物采集改为「成功写入」才计入。
- `desktop/src/utils/ensure-artifact-taskspaces.ts`：自动挂载显式使用 `reference`。
- `desktop/src/components/WorkspacePanel.tsx:1200-1203`：把隐式默认改为显式传参（不改变现有行为）。
- `desktop/electron/main.ts` 的 `link-into-session-workspace` handler：新增「已被既有 reference/copy 挂载覆盖」的守卫。
- `desktop/electron/workspace-mounts.ts`：新增覆盖判定辅助函数。
- 上述各项的单元测试。

## Out of scope（no-scope-creep 边界）

- **不改** `mode` 的三态语义、`.agx-mounts.json` 结构与版本号。
- **不改** `agenticx/cli/agent_tools.py` 的可写根推导逻辑（`link` → 可写是既定语义，本次不动）。
- **不改** `AGX_DESKTOP_UNRESTRICTED_FS` 相关的放行开关（属 `.cursor/plans/2026-07-25-session-workspace-mount-modes.plan.md` 的 P4 范围）。
- **不改** `WorkspacePanel` 手动「添加文件 / 文件夹」的三态入口与其默认值（`pendingMountMode` 默认 `reference`，见 `WorkspacePanel.tsx:245`；该路径**显式传 mode**，见 `:842`，不受本次改动影响）。
- **不把** `WorkspacePanel.tsx:1200` 的预览兜底从 `link` 改成别的模式——只做显式化。若要收紧，需单独验证预览链路，另开 plan。
- **不改** `list_taskspace_files` / `read_taskspace_file` 的任何 Python 侧逻辑（已验证支持 reference，无需改动）。
- **不清理** 工作树中其他既有改动或未跟踪文件。
- **不迁移** 历史 `.agx-mounts.json` 中已存在的 `link` 记录（用户可在 UI 手动改；自动迁移会静默降权，风险高于收益）。

## FR-1：产物采集必须区分「写成功」与「写失败／仅意图」

### FR-1a：pane 消息侧按 `toolStatus` 过滤

**落点**：`desktop/src/utils/session-artifacts.ts:340-346`，`collectSessionArtifactPaths` 内的 tool 分支。

**before**：

```ts
if (toolName === "file_write" || toolName === "file_edit") {
  const argPath = String(message.toolArgs?.path ?? "").trim();
  if (argPath) addPath(paths, seen, argPath);
  extractOkWritePaths(String(message.content || ""), paths, seen);
  extractOkWritePaths(String(message.toolResultPreview || ""), paths, seen);
}
```

**after 意图**：只有在本次写调用**没有失败**时才采信 `toolArgs.path`。判定规则（三者任一命中即视为失败，直接不采 `toolArgs.path`）：

1. `message.toolStatus === "error"`（类型见 `desktop/src/store.ts:237` 的 `ToolCallStatus`；实施前先确认该联合类型里表示失败的字面量取值，以类型定义为准，不要凭猜）；
2. `content` 或 `toolResultPreview` 以 `ERROR:` 开头（去除首部空白后判断）；
3. `content` 或 `toolResultPreview` 含 `path escapes workspace`。

`extractOkWritePaths(content / toolResultPreview)` 两行**保持不动**——它们本身就依赖 `OK: wrote|edited` 字样，天然只匹配成功结果，是失败场景下的正确兜底。

**注意**：`toolStatus` 可能为 `undefined`（历史消息或 `agent_messages` 合成行）。`undefined` **不得**被当作失败，否则会把正常产物全部漏采，导致「文件管理」空掉。只有显式失败态才拦。

### FR-1b：`agent_messages` 合成行必须由工具结果背书

**落点**：`desktop/src/utils/session-artifacts.ts:272-315`，`agentMessageRowsToCollectorMessages` 内处理 assistant `tool_calls` 的循环（`:289` 的 `if (name !== "file_write" && name !== "file_edit") continue;` 起）。

**问题**：这里从 assistant 的调用意图直接合成一个 tool 行并带上 `toolArgs.path`，此时结果尚未产生。`agent_messages.json` 中，该 call 的结果是紧随其后的 `role: "tool"` 行（以 `tool_call_id` 配对，见本会话 `agent_messages[13]` 意图 → `[14]` 的 `ERROR: path escapes workspace`）。

**after 意图**：合成 tool 行时，先在 `rows` 中按 `tool_call_id === call.id` 找到对应的 `role: "tool"` 结果行：

- 找不到结果行（尚在执行中）→ **不产出** `toolArgs.path`；
- 找到且其 `content` 命中 FR-1a 的失败特征 → **不产出** `toolArgs.path`；
- 找到且为成功 → 照现状产出。

配对实现建议：在函数开头先遍历一次 `rows`，建立 `Map<tool_call_id, contentString>`，避免 O(n²)。保持函数签名与返回类型不变。

**AC-1**（`desktop/src/utils/session-artifacts.test.ts`，沿用文件顶部既有的 `toolMsg` / `assistantMsg` helper）：

- 新增：`file_edit` 行 `toolStatus: <失败字面量>` + `content: "ERROR: path escapes workspace: /Users/damon/myWork/research-agent/requirements.txt"` → `collectSessionArtifactPaths` 返回 `[]`。
- 新增：同上但 `content` 为 `"OK: edited /Users/damon/x/a.txt"` 且无失败态 → 返回包含 `/Users/damon/x/a.txt`。
- 新增：`toolStatus` 为 `undefined` 且 `content` 为 `"OK: edited /Users/damon/x/a.txt"` → 仍返回该路径（防漏采回归）。
- 新增：`collectArtifactPathsFromAgentMessages` 输入 `[assistant(tool_calls=[file_edit path=P]), tool(tool_call_id 匹配, content="ERROR: path escapes workspace: P")]` → 返回 `[]`。
- 新增：同上但 tool 行 `content` 为 `"OK: edited P"` → 返回 `[P]`。
- 既有用例 `collects file_write path from toolArgs and OK: wrote body`（`:32-51`）等必须继续通过。

## FR-2：自动挂载器不得提权，显式使用 `reference`

**落点**：`desktop/src/utils/ensure-artifact-taskspaces.ts:156`。

**before**：`const result = await linker({ sessionId: sid, sources: paths });`

**after 意图**：显式 `mode: "reference"`。产物同步的目的是「让用户在文件管理里看到并能打开产物」，`reference` 已完全满足（见上文「已验证的安全前提」），不需要写权限。

同时把 `:168-183` 的 `stageSessionArtifacts` 老兜底分支保持原样（不同机制，不涉 mount mode）。

**落点**：`desktop/src/components/WorkspacePanel.tsx:1200-1203`。

**after 意图**：显式写出 `mode: "link"`，与当前实际行为完全一致（只消除「靠 IPC 默认值」的隐式依赖，便于后续审计）。**不要**改成 `reference`。

**AC-2**（`desktop/src/utils/ensure-artifact-taskspaces.test.ts`）：

- 新增：mock `window.agenticxDesktop.linkIntoSessionWorkspace`，断言被调用时入参 `mode === "reference"`。该文件当前只测纯函数（`sessionTaskArtifactsDir` / `shouldPruneAutoArtifactRoot`），需要为 `ensureArtifactTaskspacesForSession` 补最小 mock：`listTaskspaces` 返回 `{ ok: true, workspaces: [{ id: "default", … }] }`，`linkIntoSessionWorkspace` 返回 `{ ok: true, linked: 1, defaultDir: "/tmp/d" }`。
- 断言 `paths` 为空时**不调用** linker（保持既有短路，见 `:150`）。

## FR-3：主进程守卫——已被 reference/copy 覆盖的路径不得静默直连

**落点（新增函数）**：`desktop/electron/workspace-mounts.ts`，紧邻 `findMountForSource`（`:83-94`）新增：

```ts
/** Find a reference/copy mount whose source covers `sourcePath` (self or ancestor). */
export async function findCoveringNonLinkMount(
  defaultDir: string,
  sourcePath: string,
): Promise<MountRecord | null>;
```

实现要点：读 `readMounts(defaultDir)`，只考察 `mode !== "link"` 的记录，用**已有的** `isRealpathUnder(sourcePath, mount.source_path)`（`desktop/electron/path-guard.ts`，`workspace-mounts.ts:10` 已 import）判断覆盖关系；命中即返回。禁止用裸 `startsWith`。

**落点（接线）**：`desktop/electron/main.ts:11039-11049`。

**before**：

```ts
const existing = await findMountForSource(defaultDir, sourceReal);
if (existing) {
  if (mode === "link" && existing.mode !== "link") {
    continue;
  }
  ...
}
```

**after 意图**：在上述 `existing` 判断**之后**补一层覆盖守卫——当 `mode === "link"` 且 `findCoveringNonLinkMount` 命中时，跳过该 source（`continue`），不建 symlink、不写 mounts 记录。语义与既有那条「禁止静默升级」注释一致，只是把判定从「同一路径 / 同名」扩展到「祖先目录覆盖」。

守卫只作用于 `mode === "link"`：用户在 UI 上**显式**选择「直连原目录」时走的是同一 IPC，因此必须让显式意图仍可生效。实现方式：给 IPC payload 增加可选字段 `explicit?: boolean`，`WorkspacePanel.tsx:842` 的手动路径传 `explicit: true` 以豁免该守卫；不传或 `false` 时守卫生效。若实施时认为增字段成本偏高，可改为「守卫恒定生效」，但必须在 PR 说明里写清「显式直连一个 reference 目录下的子文件将被拒绝」这一行为变化，并同步更新 `WorkspacePanel` 的错误提示文案，让用户知道该改父目录挂载模式。**两种做法择一，不要两者混用。**

**AC-3**（新建 `desktop/electron/__tests__/workspace-mounts-cover.test.ts`；该目录目前不存在，需新建，并确认 `desktop` 的 vitest 配置会收录 `electron/__tests__`，若不收录则放到与 `workspace-mounts.ts` 同级并命名 `workspace-mounts.test.ts`）：

- 构造 `defaultDir` 内 `.agx-mounts.json` 含 `{ name: "research-agent", mode: "reference", source_path: <tmp>/research-agent }`，断言 `findCoveringNonLinkMount(defaultDir, <tmp>/research-agent/requirements.txt)` 返回该记录。
- 断言对 `<tmp>/research-agent-other/x.txt`（前缀相近但非子路径）返回 `null`。
- 断言 `mode: "link"` 的祖先挂载**不**被该函数命中（只管 reference/copy）。

## FR-4：端到端回归——复现本次事故场景

**落点**：`desktop/src/utils/session-artifacts.test.ts` 末尾新增一个 `describe`，命名体现场景（例如 `denied write must not become an artifact`）。

用本次事故的真实数据构造最小输入：assistant 发起 `file_edit`（path 为 `/Users/damon/myWork/research-agent/requirements.txt`）→ tool 行返回 `ERROR: path escapes workspace: ...`，断言 `collectArtifactPathsFromAgentMessages` 与 `collectSessionArtifactPaths` 均返回 `[]`。

这条测试是本 plan 的核心防回归资产：只要它绿，「被拒绝的写」就不可能再变成自动挂载的输入。

## 实施顺序与验收命令

按 FR-1 → FR-2 → FR-3 → FR-4 顺序，每步先写测试看它失败，再改实现。

```bash
cd /Users/damon/myWork/AgenticX/desktop
npx vitest run src/utils/session-artifacts.test.ts src/utils/ensure-artifact-taskspaces.test.ts
npx vitest run electron   # 若 FR-3 测试落在 electron/__tests__
npx tsc --noEmit
```

Python 侧未改动，但因涉及可写根语义，建议顺带确认既有守卫仍绿：

```bash
cd /Users/damon/myWork/AgenticX
python -m pytest -q --disable-warnings \
  tests/test_workspace_root_enforcement.py \
  tests/test_taskspace_mount_mode.py \
  tests/test_taskspace_symlink_resolve.py \
  tests/test_taskspace_list_symlink_guard.py
```

**手工验收（必须做，因为改的是 Electron 主进程 + 渲染进程双侧）**：改完 `desktop/electron/*` 后必须完全退出并重启 `npm run dev`（⌘Q，仅刷新渲染进程不会重载 IPC handler）。然后：

1. 新建会话，用「引用」模式添加一个本地代码目录。
2. 让 agent 去写该目录下的某个文件（绝对路径）。
3. 预期：`file_edit` 报 `path escapes workspace` 后**不再**自动出现「直连」挂载，重试**继续失败**；`.agx-mounts.json` 里不新增 `mode: "link"` 记录。
4. 让 agent 在可写根内正常写一个文件，确认「文件管理」仍能列出并点开该产物（验证 FR-2 没有把产物列表弄空）。

## 提交约定

建议按 FR 分两个 commit（FR-1+FR-4 采集侧、FR-2+FR-3 挂载侧），或单个 commit。trailer：

```
Plan-Id: 2026-07-25-artifact-autolink-privilege-escalation
Plan-File: .cursor/plans/2026-07-25-artifact-autolink-privilege-escalation.plan.md
Plan-Model: <待用户确认>
Impl-Model: <待用户确认>
Made-with: Damon Li
```

注意：按 AGENTS.md，开始实施前需把本文件从 `.cursor/plans/pending/` 移回 `.cursor/plans/` 根目录，使 `Plan-File` trailer 与实际路径一致。
