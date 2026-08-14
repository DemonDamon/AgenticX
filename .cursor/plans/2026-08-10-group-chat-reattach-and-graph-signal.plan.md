# 群聊断点续跑（event hub 接入）+ 运行图只在有真实任务图时露出

Planned-with: claude-opus-4.6-thinking
Suggested-Impl-Model:

| 子规划 | 推荐模型 | 理由 |
|--------|----------|------|
| P0-A 群聊 SSE 接入 event hub / 生产者任务化 | GPT-5.x 强推理档 | 跨栈、序列敏感（SSE 生产者-消费者、断线语义、持久化时序），回归风险最高 |
| P0-B 中途落盘 + 前端重连对账 | Codex 系列（代码专精中档） | 后端小改 + 前端既有函数扩参，路径明确 |
| P1 运行图露出收敛（presence 图不自动开） | Composer 2.5 / Fast 档 | 纯前端条件判断与文案，逻辑简单 |

---

## 1. 背景与问题

用户在群聊里提出三件互相关联的事：

1. 右侧「运行图」看不懂有什么用：`@Near` 之后虚线却连着另一个分身（已在前一轮修复 stale 边，但根因是**普通群聊里的运行图只是 presence 图**，信息与成员列表重复）。
2. 运行图的必要性存疑：除「可观测」之外，在普通聊天场景没有增量价值，反而制造困惑。
3. 希望群聊在网络抖动断开后能「断点」快速拉起，最好无缝。

排查后确认：**当前群聊断线不是「流断了、后台还在跑」，而是整轮直接终止**，这与单聊（Machi 主会话）已有的 live reattach 能力存在明显断层。运行图之所以显得没用，是因为普通群聊压根没有 task DAG，只有 presence 节点。

## 2. 根因与证据链（实施者可自行复核）

### 2.1 群聊 SSE 完全绕过 event hub

- `agenticx/studio/server.py` L2914 `if is_group_session:` 分支内的 `_group_chat_stream()`（L2929–L3046）：
  - **没有**调用 `live_reattach_enabled()`（`agenticx/studio/continuation.py` L49），**没有**调用 `manager.ensure_event_hub(...)`（`agenticx/studio/session_manager.py` L674）。
  - 所有事件都是在响应生成器内直接 `yield f"data: {json.dumps(evt.model_dump())}\n\n"`（L2993 / L3003 / L3036 / L3038）。
  - 对比单聊路径：L3077–L3085 建 hub，L3536 `runtime_task = asyncio.create_task(_produce_meta_events())`，L3538–L3555 由生成器**订阅 hub** 输出；L3614–L3619 在 `client_disconnected` 且 hub 存在时**明确不取消** runtime，日志 `"[chat] client disconnected, runtime continues (hub)"`。
- 因此 `GET /api/sessions/{sid}/stream`（server.py L3876 `reattach_session_stream`）对群聊会话恒定走 `hub is None` 分支 → 只能从 bus replay 或直接返回 `{"type":"done","data":{"reason":"not_running"}}`（L3929）。前端 `reattachLiveStream`（`desktop/src/components/ChatPane.tsx` L6168）拿不到任何内容。

### 2.2 断线即终止整轮

- `_group_chat_stream` 把断连探测直接塞进消费循环：L3019–L3020
  ```python
  async for reply in router.run_group_turn(...):
      if await request.is_disconnected():
          break
  ```
  且把 `should_stop=request.is_disconnected` 传进 router（L3016）。`GroupChatRouter._should_stop`（`agenticx/runtime/group_router.py` L830）在每个成员回复前后被检查（L686 / L705 / L1316 / L1357 / L1420 …）。
- 结果：网络抖动后，**尚未发言的成员永远不会再发言**，本轮就地结束。用户体感是「群聊断了就废了」。

### 2.3 群聊没有轮内落盘

- 群聊回复写入内存历史的唯一入口是 `GroupChatContext.append_agent`（`agenticx/runtime/group_context.py` L71，写 `session.chat_history`），调用点在 `group_router.py` L992 / L1201 / L1552。
- 但 `_group_chat_stream` 只在 `finally` 里 `await manager.persist_async(...)`（server.py L3043）；**没有** `manager.incremental_persist(...)`。对比单聊有 `_mid_turn_persist_cb`（server.py L3137–L3141）注入 `AgentRuntime(mid_turn_persist=...)`。
- 后果：后端崩溃 / 强杀时，本轮已生成的群聊回复全部丢失；重连后从磁盘对账也拿不到轮内进度。

### 2.4 普通群聊的运行图是 presence 图，与成员列表信息重复

- `group_router._project_h2a_fanout` / `_project_a2a_message_edge`（L582 / L523）在**每次**有 @ 或成员互点时调用 `ensure_presence_run`（`agenticx/runtime/graph/social.py` L49），该 run 的 `meta={"source": "presence", "ephemeral": True}`（social.py L82），节点只有 `human` + `agent:*`，**没有 `kind == "task"` 节点**。
- 前端已有判定 `graphHasTaskNodes`（`desktop/src/components/graph/graph-types.ts` L121），`RunGraphPanel` 用它隐藏「专家/任务」切换（`RunGraphPanel.tsx` L120–L125）——说明「presence-only」这一区分已经存在，只是**没有用于控制面板是否自动露出**。
- 自动露出逻辑在 `ChatPane.tsx` L9204–L9223：只要收到 `graph.run_created` 且 `localStorage["agx-graph-panel-autopen-v1"] !== "done"`，就打开工作区侧栏并 `setWorkPanelFocus({ kind: "graph" })`。presence run 也会触发它 → 用户第一次在普通群聊 @ 人就被弹出一个「看不懂的图」。

## 3. 目标与非目标

### In scope

- FR-1：群聊 SSE 接入 per-session event hub，生产者与响应流解耦；断线后本轮继续跑完。
- FR-2：群聊轮内增量落盘，崩溃/重连后磁盘即为可信进度。
- FR-3：群聊会话可通过既有 `GET /api/sessions/{sid}/stream` 重连并续看本轮剩余事件。
- FR-4：前端重连期间群聊气泡可见（复用磁盘对账，不新造消息 id 体系）。
- FR-5：presence-only 运行图不再自动弹出面板；用户手动打开时给出诚实空态文案。

### Out of scope（明确不做，防 scope creep）

- 不改 `GroupChatRouter` 的路由决策、prompt、回复长度策略（上一轮已改，勿再动）。
- 不改 presence 图的建图逻辑本身（`ensure_presence_run` / `project_h2a_fanout` 保持现状，只改**露出条件**）。
- 不做 task DAG 的新建能力（群聊里生成真实 Workforce 任务图是另一条线）。
- 不动单聊 `_produce_meta_events` 既有逻辑；只做「照抄模式」，不重构它。
- 不改 `agenticx/studio/server.py` 顶部 import 区块以外的无关代码；改 import 时**逐行增删**，禁止整段替换（见 AGENTS.md 关于该文件的强制约束）。

## 4. 需求与验收

### FR-1 群聊 SSE 接入 event hub（P0）

**落点**：`agenticx/studio/server.py`，`is_group_session` 分支（L2914 起）。

改造为与单聊同构的「生产者 task + 生成器订阅 hub」结构：

1. 在 `async def _group_chat_stream()` **定义之前**（L2928 `setattr(session, "_usage_owner_session_id", ...)` 之后）插入：
   ```python
   group_use_event_hub = live_reattach_enabled()
   group_event_hub = (
       manager.ensure_event_hub(payload.session_id) if group_use_event_hub else None
   )
   ```
   `live_reattach_enabled` 已在本文件 import（reattach 端点 L3890 已用），无需新增 import。

2. 新增生产者协程 `_produce_group_events()`，把现有 L2930–L3036 的**全部业务逻辑原样搬进去**，唯一差别是「输出」从 `yield 字符串` 变成 `await _emit_group_event(evt)`：
   ```python
   async def _emit_group_event(evt: SseEvent) -> None:
       """Publish to hub when enabled, else queue for the local generator."""
       if group_event_hub is not None:
           await group_event_hub.publish(
               RuntimeEvent(
                   type=evt.type,
                   data=dict(evt.data or {}),
                   agent_id=str((evt.data or {}).get("agent_id") or "meta"),
               )
           )
       else:
           await group_fallback_queue.put(evt)
   ```
   - `RuntimeEvent.type` 是普通 `str`（`agenticx/runtime/events.py` L56–L61），因此 `group_reply` / `group_typing` / `group_progress` / `graph.*` 都可直接承载，无需扩枚举。
   - `group_fallback_queue: asyncio.Queue[SseEvent | None] = asyncio.Queue()`，仅在 hub 关闭时使用（保持关闭 flag 时行为与现状一致）。

3. `should_stop` 从「客户端断连」改为「用户显式中断」：
   - before：`should_stop=request.is_disconnected`（L3016）
   - after：`should_stop=lambda: manager.should_interrupt(payload.session_id)`
     （`SessionManager.should_interrupt` 见 session_manager.py L818）
   - 同时**删除**消费循环里的 `if await request.is_disconnected(): break`（L3019–L3020）——生产者不再感知 HTTP 连接。

4. 生产者结束时：
   ```python
   finally:
       manager.clear_interrupt(payload.session_id)
       manager.set_execution_state(payload.session_id, "idle")
       await manager.persist_async(payload.session_id)
       if group_event_hub is not None:
           await group_event_hub.publish_done()
       else:
           await group_fallback_queue.put(None)
   ```
   注意：原 `finally`（L3040–L3043）在响应生成器里，现在必须**整体迁到生产者**，否则断线时会提前把状态置 idle、并在轮跑完前落盘。

5. 响应生成器改为：
   - hub 模式：`group_runtime_task = asyncio.create_task(_produce_group_events())`，然后 `sub_id, sub_q, _ = group_event_hub.subscribe()`，循环照抄 server.py L3540–L3555（`request.is_disconnected()` → 置 `client_disconnected = True; break`；`buffered.event is None` → 发 `done` 并 break；正常事件 → `for line in _buffered_event_to_sse_lines(buffered): yield line`）。
   - 非 hub 模式：从 `group_fallback_queue` 取，逐条 `yield f"data: {json.dumps(evt.model_dump(), ensure_ascii=False)}\n\n"`，取到 `None` 时 yield `done` 并 break。
   - `finally`：`group_event_hub.unsubscribe(sub_id)`；**当 `client_disconnected and group_event_hub is not None` 时不取消 `group_runtime_task`**，只 `logger.info("[group] client disconnected, runtime continues (hub) session=%s", ...)`（对齐 L3614–L3619）。

**AC-1**
- `tests/test_smoke_group_reattach_hub.py`（新建）：
  - `test_group_stream_publishes_to_event_hub`：patch `live_reattach_enabled` 返回 True，用 `TestClient` 打 `/api/chat`（群聊 payload），断言 `manager.get_event_hub(sid)` 非 None，且 hub 缓冲里出现 `type == "group_reply"` 的事件。
  - `test_group_turn_survives_client_disconnect`：mock 一个 `run_group_turn` 生成 3 条 reply（每条 `await asyncio.sleep(0.05)`）；客户端读到第 1 条后关闭连接；断言最终 `session.chat_history` 里 3 位成员的回复都在（即 `should_stop` 不再被 HTTP 断连触发）。
  - `test_group_should_stop_uses_interrupt`：`manager.request_interrupt(sid)` 后断言 router 收到的 `should_stop()` 为 True 且轮次提前结束。

### FR-2 群聊轮内增量落盘（P0）

**落点**：同上生产者内，事件发布之后。

在生产者消费 `router.run_group_turn` 的循环里，当 `evt_type in {"group_reply", "group_skipped"}` 时追加：
```python
try:
    manager.incremental_persist(payload.session_id)
except Exception:
    pass
```
（与单聊 `_mid_turn_persist_cb` server.py L3137–L3141 同语义；不要改 `persist_async` 的最终调用。）

**AC-2**
- `tests/test_smoke_group_reattach_hub.py::test_group_replies_persist_mid_turn`：mock `run_group_turn` 产出 2 条 reply 后抛异常；断言磁盘 `messages.json` 已含第 1、2 条回复（不依赖 `finally` 的最终 persist）。

### FR-3 群聊会话可重连（P0）

无需改 reattach 端点——FR-1 完成后 `manager.get_event_hub(sid)` 对群聊会话即非 None，L3902–L3980 的 replay + live 订阅逻辑自动生效。

**AC-3**
- `tests/test_smoke_group_reattach_hub.py::test_group_reattach_replays_and_continues`：
  1. 后台起群聊 `/api/chat`（mock router 产 3 条 reply，间隔 0.1s）；
  2. 读到第 1 条后断开；
  3. 打 `GET /api/sessions/{sid}/stream?since=<lastSeq>`；
  4. 断言收到第 2、3 条 `group_reply` 以及最终 `done`，且没有重复投递第 1 条。

### FR-4 前端重连期间群聊气泡可见（P0）

**落点**：`desktop/src/components/ChatPane.tsx`

1. `mergeTailFromDisk`（L6119–L6159）扩一个可选参数：
   - before：`async (sid: string): Promise<boolean> => { if (sessionStreamStateRef.current[sid]?.active) return false; ... }`
   - after：`async (sid: string, opts?: { allowDuringStream?: boolean }): Promise<boolean> => { if (!opts?.allowDuringStream && sessionStreamStateRef.current[sid]?.active) return false; ... }`
   - 其余逻辑（pane 归属校验 L6134–L6137、`mergeSessionMessagesTail`）**不动**。
2. `reattachLiveStream`（L6168 起）在帧解析处（L6205–L6215 之后）新增群聊分支：
   ```ts
   if (p.type === "group_reply" || p.type === "group_skipped") {
     // Group replies are persisted mid-turn (FR-2); re-read the tail through the
     // canonical merge so ids stay aligned with disk instead of minting live rows.
     void mergeTailFromDisk(sid, { allowDuringStream: true });
     continue;
   }
   ```
   为避免高频抖动，用一个 `debounce ~300ms`（模块内 `useRef<number>` 定时器即可，勿引三方库）。
3. `graph.*` / `group_typing` 帧在重连期忽略（不渲染），落轮结束由 `finally` 的 `mergeTailFromDisk(sid)` 收口。

**AC-4**
- `desktop/src/utils/__tests__` 不适用；在 `desktop/src/components/graph/graph-types.test.ts` 同级新建 `desktop/src/utils/session-reattach.test.ts` 追加用例：断言 `parseSseFrame` 能解析 `type: "group_reply"` 帧（纯函数级）。
- 手工验收：群聊发一条会触发 3 位成员的问题 → 生成中拔网/切 WiFi 5 秒 → 恢复后**不刷新页面**，气泡在 ~1 秒内继续出现，且不出现重复气泡。

### FR-5 运行图露出收敛（P1）

**落点 1**：`desktop/src/components/ChatPane.tsx` L9204–L9223 的 autopen。
- before：收到 `graph.run_created` 即 autopen。
- after：仅当该 run 已出现 `kind === "task"` 节点时才 autopen。实现：把 autopen 判定移到 `graph.node_updated` 处理之后，用 `graphHasTaskNodes(useGraphRunStore.getState().byPane[pane.id]?.nodes)` 作为前置条件；`graph.run_created` 只更新 `activeGraphRunId`（保留 L9205–L9209）。
  - `graphHasTaskNodes` 已导出于 `desktop/src/components/graph/graph-types.ts` L121。
  - `localStorage["agx-graph-panel-autopen-v1"]` 的一次性语义保留不变。

**落点 2**：`desktop/src/components/graph/RunGraphPanel.tsx`（`hasTaskNodes` 已在 L120 算好）。
- 当 `hasRun && !hasTaskNodes` 时，在图上方展示一行诚实说明，替代上一轮加的长解释：
  `本轮只有「谁在答」的协作关系；出现可拆解的任务时，这里会显示任务分工与依赖，并支持注入 / 改派。`
- `WorkPanel.tsx` L1441–L1446 的入口 subtitle 同步为：`任务拆解时观察分工与依赖，并做注入 / 改派干预`（保持一句话，不加长文）。

**AC-5**
- `desktop/src/components/graph/graph-types.test.ts` 追加：`graphHasTaskNodes` 对 presence-only 图返回 false（已有 L13 用例，确认不回归即可）。
- 手工验收：新环境首次在普通群聊 @ 某分身 → 右侧面板**不自动弹出**；手动打开运行图 → 见 presence 节点 + 上述说明文案；触发一个真会产生 Workforce 任务节点的场景 → 面板按旧逻辑自动弹出一次。

## 5. 实施顺序与提交切分

1. `commit 1` FR-1 + FR-2（后端 hub 接线 + 轮内落盘 + FR-1/FR-2 测试）
2. `commit 2` FR-3 验收测试（若 commit 1 已含则合并）
3. `commit 3` FR-4 前端重连对账
4. `commit 4` FR-5 运行图露出收敛

每个 commit 前置门槛：
- 后端改动（尤其 `server.py`）必须冷启动验证：`agx serve --host 127.0.0.1 --port <临时端口>`，确认进程不崩且 `/api/session`、`/api/avatars`、`/api/sessions` 均 200（AGENTS.md 强制要求）。
- 前端改动：`cd desktop && npx tsc --noEmit && npm test`。
- `pytest tests/test_smoke_group_reattach_hub.py tests/test_smoke_group_a2a_graph_edges.py -q` 全绿。

## 6. 风险与回滚

| 风险 | 说明 | 缓解 |
|------|------|------|
| 群聊轮次在客户端关闭后仍跑完 | 用户关窗后仍消耗 token | 只有 `runtime.live_reattach_enabled = true` 时才启用；关闭 flag 时行为完全回退到现状（fallback queue 路径） |
| `set_execution_state("idle")` 时序变化 | 状态迁到生产者末尾，切会话时列表可能短暂显示 running | 与单聊一致；`SessionHistoryPanel` 既有 running 展示逻辑不变 |
| 重连期 `mergeTailFromDisk(allowDuringStream)` 与前台流打架 | 只在 reattach 路径传该参数，前台 SSE 路径不传 | 保留 L6134–L6137 的 pane/sid 归属校验；debounce 降频 |
| autopen 条件变严导致「图再也不弹」 | 若真实 task DAG 场景也没有 `kind=task` 节点则永不弹 | 保留手动入口（WorkPanel 起始页 + toolbar），并在 AC-5 手工验收里覆盖 task 场景 |

## 7. 与「运行图必要性」这一产品问题的结论

本 plan 的立场是：**运行图不是聊天的必需件，而是复杂协作的干预台**。因此不再让它在普通群聊里抢注意力（FR-5），只在真有任务分工时出现；而用户真正关心的「断线快速拉起」由 event hub + 轮内落盘（FR-1/2/3/4）解决，**与运行图无关**——运行图承担的是编排层恢复（谁做到哪一步、要不要改派），不承担聊天流的重连。
