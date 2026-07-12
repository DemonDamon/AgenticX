# Desktop 工具结果终态对账加固计划

Planned-with: GPT-5.6 Sol

Suggested-Impl-Model: GPT-5.6 Sol

## 目标

彻底消除 Desktop 在 SSE 对话结束后将未匹配 `tool_result` 作为匿名 `tool` 卡片追加到最终回复之后、切换会话后该卡片又消失或移位的问题，保证流式内存态与磁盘历史重载态的工具名称、去重结果和消息顺序一致。

## 根因与证据链

事故会话：`335a6079-0499-4bb7-92f5-943ef3816f15`。

1. `~/.agenticx/sessions/<session_id>/messages.json` 中最后一轮顺序为：
   `assistant(reasoning) -> tool(bash_exec, done, tool_call_id=functions.bash_exec:0) -> assistant(final)`。
2. 首次流式渲染却在最终回复之后显示“已调用 1 次工具 · 1 次 tool”。`tool` 是
   `desktop/src/components/messages/TurnToolGroupCard.tsx` 中工具名缺失时的默认值。
3. `desktop/src/components/ChatPane.tsx` 的 `pendingToolResultPatchesRef` 只保存结果 patch，
   未保存 `toolName` / `toolArgs` / `toolGroupId`。
4. 当前 `finally` 在最终 assistant 气泡提交之后才 flush 未匹配结果，并直接
   `addPaneMessageIfSessionActive()`，因此：
   - 卡片顺序落在 FINAL 之后；
   - 卡片缺少 `toolName`，展示为匿名 `tool`；
   - flush 前不重试按 `tool_call_id` 合并，可能制造重复卡。
5. 切换会话后 `mapLoadedSessionMessage()` 从权威 `messages.json` 重建消息，临时匿名卡被替换，
   所以异常消失。这证明问题在 Desktop 内存态终态对账，不代表后端工具仍在运行。
6. 该回归由 commit `501330af` 的“未消费 patch 在 finally 兜底追加”路径引入。

## In scope

- `desktop/src/components/ChatPane.tsx` 的 Meta-Agent SSE `tool_result` 暂存与 turn finalization。
- 新增一个纯函数工具结果对账模块及单元测试。
- 流式内存态中未匹配工具结果的名称、参数、状态、分组及顺序。
- 正常完成、异常结束两条清理路径的幂等去重。

## Out of scope

- 不改变后端 `agenticx/runtime/agent_runtime.py` 的工具事件协议。
- 不改变工具卡视觉样式、默认折叠规则或历史持久化格式。
- 不修改现有事故会话数据。
- 不处理无关的会话持久化、SSE 重连或 live reattach 架构。

## 设计

### FR-1：暂存完整工具结果上下文

新增 `desktop/src/utils/pending-tool-result.ts`：

- 每次 `sendChat` 使用请求局部的 pending 容器，禁止组件级 ref 被不同 session 的并发流互相清空。
- `PendingToolResult` 必须包含：
  - `callId`
  - `toolName`
  - `toolArgs`
  - `toolGroupId`
  - `patch`（content/status/preview/stream lines）
- `buildPendingToolFallback()` 将 pending 转换为完整的 `MessageToolExtras`，不得丢失工具名。
- `hasMatchingToolCall()` 按 `ownerSessionId + toolCallId` 判断当前 pane 是否已存在对应工具卡。

`ChatPane.tsx` 在收到无法立即合并的 `tool_result` 时保存完整对象，不再只保存 patch。
`store.ts` 的 pane 工具更新 API增加可选 session 约束；SSE 路径必须传入
`requestSessionId`，禁止旧会话迟到事件误更新新会话中相同 `tool_call_id` 的卡片。

### FR-2：FINAL 前完成终态对账

在 `ChatPane.tsx` 的 SSE reader 循环结束后、计算并提交最终 assistant 气泡之前调用本地
`flushPendingToolResults()`：

```ts
for (const pending of pendingResults) {
  if (updatePaneMessageByToolCallId(pane.id, pending.callId, pending.patch)) {
    continue;
  }
  addPaneMessageIfSessionActive(
    pane.id,
    "tool",
    pending.patch.content,
    "meta",
    undefined,
    undefined,
    undefined,
    buildPendingToolFallback(pending),
  );
}
clearPending();
// 此后才提交 assistant final
```

这样真实工具历史仍可见，但只能出现在最终回答之前，且显示真实工具名。

### FR-3：异常路径保持幂等

`finally` 保留 safety flush，但复用同一个 `flushPendingToolResults()`：

- 正常路径已清空时 no-op；
- 若 pending 对应工具卡后来已出现，先重试 merge，禁止重复追加；
- 只有确实没有对应卡时才创建完整 fallback；
- 会话已切走时，结果必须合并进该 session 的 deferred tool_call；不存在 deferred call
  才追加完整 deferred fallback，不得更新当前会话消息，也不得静默丢弃；
- 连续调用 flush 必须幂等。

## TDD 实施步骤

### Task 1：建立失败回归测试

**新增：**
- `desktop/src/utils/pending-tool-result.test.ts`

**断言：**

1. pending fallback 保留 `toolName=bash_exec`、`toolCallId`、`toolArgs`、`toolGroupId` 和终态。
2. 当前消息中已有相同 `ownerSessionId + toolCallId` 时，对账结果要求 merge，不生成 fallback。
3. 相同 `toolCallId`、不同 `ownerSessionId` 不得匹配。
4. 对账消费后再次调用不生成新卡（由消费/清空契约保证）。
5. 名称缺失时按 metadata → payload → `functions.<name>:<index>` call ID 恢复。

**RED 命令：**

```bash
cd desktop
npx vitest run src/utils/pending-tool-result.test.ts
```

预期：因模块或导出不存在而失败。

### Task 2：实现纯对账模块

**新增：**
- `desktop/src/utils/pending-tool-result.ts`

实现完整 typed API，不使用 `any`，不依赖 React/Zustand。

**GREEN 命令：**

```bash
cd desktop
npx vitest run src/utils/pending-tool-result.test.ts
```

预期：全部通过。

### Task 3：接入 ChatPane 终态路径

**修改：**
- `desktop/src/components/ChatPane.tsx`
  - 请求局部 pending 容器锚点（约 L7380）
  - `payload.type === "tool_result"` 锚点（约 L8217）
  - SSE reader 结束、`const trimmedFull` 前（约 L8897）
  - `finally` leftover flush（约 L8969）
- `desktop/src/store.ts`
  - `updatePaneMessageByToolCallId` 类型与实现：增加可选 `ownerSessionId` 精确匹配

要求：

- 暂存完整 `PendingToolResult`；
- 抽取单一 `flushPendingToolResults()`；
- 正常路径 FINAL assistant 之前 flush；
- finally 只作幂等安全兜底；
- 不触碰其它工具、子智能体、附件或历史逻辑。

### Task 4：回归验证

```bash
cd desktop
npx vitest run \
  src/utils/pending-tool-result.test.ts \
  src/components/messages/tool-call-card-title.test.ts
npm run build
```

并检查 IDE diagnostics。仓库当前独立 `npx tsc --noEmit` 存在与本需求无关的基线错误，
不作为本计划验收门；`npm run build`（Vite renderer build + Electron tsc）必须成功。

## 验收标准

- AC-1：未匹配结果 fallback 显示真实工具名，绝不显示匿名 `tool`。
- AC-2：FINAL assistant 后不得新增该轮工具卡。
- AC-3：相同 `tool_call_id` 最多存在一张工具卡。
- AC-4：工具结果先于工具调用、工具调用缺帧、正常顺序三种情况均可收敛。
- AC-5：切换离开并返回会话前后，工具卡名称、数量和相对 FINAL 顺序一致。
- AC-6：工具终态对账、工具卡标题测试与 Desktop production build 回归通过。

## No-scope-creep 边界

本次仅修复上述四个精确落点与新增纯函数测试模块。不得顺手重构 `ChatPane.tsx`、调整 UI 样式、改变后端协议或处理其它会话问题。
