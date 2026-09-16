# wb-bridge 可见性 C：产物卡 + Meta 验盘纪律

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: composer-2.5-fast
主规划：`.cursor/plans/pending/2026-09-05-wb-bridge-desktop-visibility.plan.md`
**前置：** 子规划 A 全绿。不依赖 B 的轮询（产物卡读工具结果 JSON 即可）。

---

## 1. 根因

1. `collectSessionArtifactPaths`（`desktop/src/utils/session-artifacts.ts` L563-575）只把 `file_write` / `file_edit` / `bash_exec` 当产物。`wb_bridge_send` / `wb_bridge_describe` 的 JSON 即使带 `written_paths`，助手气泡下也不会出现 `TurnArtifactCard`（`MessageRenderer.tsx` L245-260）。
2. Meta 纪律（`agenticx/runtime/prompts/meta_agent.py` L967-969）禁止读桥日志、禁止重发，**没禁止**用 `bash_exec`/`file_read` 去碰 `/tmp` 或 WB `cwd`。E2E `a9ba788c-…` 因此 7 次 `path escapes workspace`，主气泡还可能写成失败。

既有卡片 `TurnArtifactCard` 已支持 `/tmp/hello.txt`（`TurnArtifactCard.test.tsx`），**禁止新做一套芯片**。

---

## 2. In scope / Out of scope

### In scope

1. `session-artifacts.ts`：从 `wb_bridge_send` / `wb_bridge_describe` 的 JSON 内容读 `written_paths`。
2. 对应单测 `desktop/src/utils/session-artifacts.test.ts`。
3. `wb-bridge-ui.ts`：success 文案列出路径（最多 5 条 + 「等 N 个」）；`ChatPane.tsx` / `ChatView.tsx` 已调用 `formatWbBridgeSendToolResult`，**签名不变则不必改这两个文件**。
4. `wb_bridge_describe` 的 tool description 补一句 `written_paths`（`agenticx/cli/agent_tools.py` L1290-1297 **追加**，不重写）。
5. `meta_agent.py` L967-969 三段后**追加**两条纪律（禁止验盘 / 收尾列路径）。
6. `formatWbBridgeDescribeResult`（可选同一文件）：describe 原始 JSON 也格式化，供 `ChatPane` 在 `toolName === "wb_bridge_describe"` 与 send 并列调用。若加这一支，只在 `ChatPane.tsx` L2494 旁加 4 行对称分支；`ChatView.tsx` L223 同样。

### Out of scope

- 不改 `TurnArtifactCard` 视觉、不改工作区挂载策略、不改沙箱允许根。
- 不改体检评分。
- 不改 `server.py`、`cc_bridge/**`、`agent_runtime.py`。
- 不把 `/tmp` 自动加进工作区。

---

## 3. 硬约束

- `addPath` / `looksLikeArtifactFile` 继续过滤无扩展名路径。`/tmp/agx-near-desktop-e2e.txt` 有扩展名，必须收下。无扩展名（如 `/tmp/foo`）可被现有 `looksLikeArtifactFile` 丢掉——**保持该函数原样**，不要为 WB 放宽「必须有后缀」（以免把目录扫进来）。
- 只在 `status` 为 `success` / `blocked` / `error` / 缺省但 `written_paths` 非空时收集；`running` 的路径留给 B 的进度卡，避免未完成写入进「全部产物」。
- Meta 只**追加**两行，不得改 cc_bridge 三条或 import 区。
- `formatWbBridgeSendToolResult` 失败仍 `null`。

---

## 4. 改动落点

### FR-C1 产物收集

`desktop/src/utils/session-artifacts.ts` 在 `collectSessionArtifactPaths` 的 `role === "tool"` 分支、`bash_exec` 之后增加：

```ts
      } else if (toolName === "wb_bridge_send" || toolName === "wb_bridge_describe") {
        extractWbBridgeWrittenPaths(
          String(message.content || ""),
          paths,
          seen,
        );
        extractWbBridgeWrittenPaths(
          String(message.toolResultPreview || ""),
          paths,
          seen,
        );
      }
```

同文件新增（顶层，勿 inline）：

```ts
function extractWbBridgeWrittenPaths(
  raw: string,
  paths: string[],
  seen: Set<string>,
): void {
  const text = String(raw || "").trim();
  if (!text.startsWith("{")) return;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const status = String(parsed.status || parsed.turn_state || "");
    if (status === "running") return;
    const list = parsed.written_paths;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      addPath(paths, seen, String(item || "").trim());
    }
  } catch {
    /* formatted Chinese tool cards are not JSON — ignore */
  }
}
```

注意：B 段会把**进行中**工具卡 `content` 改成中文 live 文案（非 JSON）。因此产物收集必须同时看 `toolResultPreview`（最终 JSON）以及**完成后** `formatWbBridgeSendToolResult` 的文本。

完成后的格式化文本不是 JSON，所以 FR-C2 必须在格式化结果里用绝对路径明文，`extractAbsArtifactPathsFromText` 才能扫到（该文件已有 `/tmp` 正则 `ABS_PATH_BODY`）。

### FR-C2 格式化带路径

`wb-bridge-ui.ts` 在 success / blocked / error 正文后追加（最多 5 条）：

```
产物：
`/tmp/a.txt`
`/tmp/b.py`
```

用反引号包绝对路径，以便 `ABS_PATH_BODY` + `INLINE_ABS_PATH_RE` 命中。超过 5 条写 `…共 N 个`。

`observedToolsLine` 的 success 展示已在 B；若 B 未实施，C 仍须保证 success 列出路径（本段独立可交付）。

### FR-C3 describe 工具卡

`ChatPane.tsx` L2494 后：

```ts
  if (toolName === "wb_bridge_describe") {
    const formatted = formatWbBridgeSendToolResult(resultText);
    if (formatted) return { content: formatted, silent: false };
  }
```

`formatWbBridgeSendToolResult` 已能吃 describe 形状（`status` 可从 `last_terminal_kind` 回落——若 describe 没有 `status` 只有 `turn_state` / `last_terminal_kind`，在解析里：`status = parsed.status || parsed.last_terminal_kind || (turn_state === "running" ? "running" : "")`）。这一回落写在 `formatWbBridgeSendToolResult` 开头，单测一条 describe 快照。

### FR-C4 describe schema

`agenticx/cli/agent_tools.py` L1294-1297 的 description **末尾追加**：

` Also returns written_paths (absolute files from Write/Edit this turn). Treat written_paths plus result_text as delivery evidence; do not bash_exec or file_read the WB cwd or /tmp to verify.`

既有 “Do NOT try to read” 句必须保留。

### FR-C5 Meta 纪律

`agenticx/runtime/prompts/meta_agent.py` 在 L969 后插入：

```
        "- **wb_bridge 验收禁令**：禁止用 `bash_exec`/`file_read`/`ls`/`cat` 去读 WB 会话 cwd 或 `/tmp` 证明落盘（沙箱会拒，且结果不代表失败）。验收只信 `wb_bridge_describe` / `written_paths` / `result_text`。\n"
        "- **wb_bridge 收尾清单**：向用户复述 session_id、status、observed_tools，并逐条列出 `written_paths`；没有路径则明确说「桥未回报路径」，不要改口成任务失败。\n"
```

---

## 5. AC

- **AC-C1** `session-artifacts.test.ts`：构造一条 `role:"tool" toolName:"wb_bridge_send" content: JSON.stringify({status:"success", written_paths:["/tmp/agx-near-desktop-e2e.txt"]})`，`collectSessionArtifactPaths` 含该路径。
- **AC-C2** 同上但 `status:"running"` → **不含**该路径。
- **AC-C3** `formatWbBridgeSendToolResult` success + 两条 written_paths → 输出含两个反引号路径。
- **AC-C4** describe 快照 `{turn_state:"idle", last_terminal_kind:"success", written_paths:["/tmp/a.py"], last_result_text:"ok"}` 经 `formatWbBridgeSendToolResult` 非 null，且含 `ok` 与 `/tmp/a.py`。
- **AC-C5** `tests/test_smoke_wb_bridge.py`：断言 `wb_bridge_describe` 的 description 含 `written_paths` 与 `do not bash_exec`（大小写不敏感）。
- **AC-C6** 读 `meta_agent.py` 源文件断言含 `wb_bridge 验收禁令` 与 `wb_bridge 收尾清单`（可放在已有 prompt 单测；没有则 `test_smoke_wb_bridge.py` 读文件即可）。
- **AC-C7** `npx vitest run src/utils/session-artifacts.test.ts src/utils/wb-bridge-ui.test.ts`；`pytest tests/test_smoke_wb_bridge.py --no-cov` 绿。
- **AC-C8** diff 不得出现 `server.py` import 区、`cc_bridge/**`、`agent_runtime.py`。`ChatPane.tsx` 若只加 describe 四行，不得改发送/附件。

---

## 6. 实施顺序

1. AC-C1/C2 失败 → `extractWbBridgeWrittenPaths` → 绿。
2. FR-C2/C3 格式化 + describe 回落 → AC-C3/C4。
3. FR-C4/C5 文案 → AC-C5/C6。
4. 全量 AC-C7 + diff。

人工：用 Near 对 Meta 再发一次「acceptEdits 写 /tmp/…txt」。期望：

- 助手气泡下出现 `TurnArtifactCard`（可点「在访达中显示」）。
- 主气泡列出路径，且**不再**出现一串 `path escapes workspace`。

## 7. 提交

`feat(desktop): surface delegated write paths as session artifacts`

禁止 commit 里写第三方产品名。
