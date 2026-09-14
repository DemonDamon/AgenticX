# AgenticX 可回读工具观察实施计划
Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: GPT-5.6 Sol medium（主接线涉及 `agent_runtime.py` 两条工具结果路径，回归风险高）；纯测试与工具 schema 子任务可用 Composer 2.5
Plan-Id: 2026-09-14-evidence-preserving-tool-observations
Source: `research/codedeepresearch/SoL-Pi/SoL-Pi_source_notes.md`、`conclusions/runtime_module_conclusion.md`、`conclusions/tools_module_summary.md`、真实故障记录与工具循环基线

> **For implementer:** 开始实施前，将本文件移到 `.cursor/plans/2026-09-14-evidence-preserving-tool-observations.plan.md`。使用 `executing-plans`，严格按 TDD 顺序执行。不要 commit，除非用户明确要求；若用户要求 commit，使用 `/commit --spec=.cursor/plans/2026-09-14-evidence-preserving-tool-observations.plan.md`，并先询问实际 `Impl-Model`。

**Goal:** 让 AgenticX 在压缩大型工具输出时始终保留当前会话内可验证、可分页、可搜索的原始结果回读入口，并让“同参数得到同一证据”的重复只读调用不再刷新进展，减少重复读文件、重复跑命令、错误诊断和“没有按照指令完成”。

**Architecture:** 保留现有 `ContextCompactor.micro_compact_tool_result()` 的预算与专项语义，在其外层增加一个“原文归档 → 紧凑观察投影 → `tool_result_recall` 精确回读”的确定性协议。原始结果在任何有损投影前写入当前 session 的内容寻址对象目录；模型上下文、会话历史和 Desktop 工具卡仍只保存紧凑结果，但紧凑结果携带稳定 observation id 和明确回读指令。回读工具只接受 id、字节游标或字面量查询，不能传文件路径，不能越过当前 session。LoopDetector 同时记录“工具名 + 参数签名 + 原始结果摘要”，第二次得到完全相同证据时标记 `has_progress=False` 并提示复用 observation，而不是把重复动作当作新进展。

**Tech Stack:** Python 3.10+、现有 AgenticX Studio tool schema/dispatch、`ContextCompactor`、session 磁盘目录、pytest；零新增依赖、零远程 reducer、零 Desktop UI 改动。

---

## 1. 战略判定

### 1.1 选择的最高 ROI 方案

实施“Evidence-Preserving Tool Observation”：

1. 大型 `bash_exec` / `file_read` / `liteparse` / `mcp_call` / `web_fetch` 等结果先归档原文。
2. 保留现有头尾压缩，追加稳定 `obs_<sha256>` 句柄、原始长度与回读指令。
3. 新增始终可用的只读工具 `tool_result_recall`：
   - 按 `offset_bytes` 分页精确读取；
   - 或按 `query` 做字面量搜索并返回匹配行附近原文；
   - 输出有硬上限，不允许递归打包。
4. 当前 session 重启后仍能仅凭 observation id 回读原文。
5. 相同只读工具参数再次得到相同原文时，不再刷新 LoopDetector 的进展标记，并给下一轮复用/回读提示。
6. 归档或句柄生成失败时回退现有 `micro_compact` 行为，不影响工具主路径。

### 1.2 为什么它比另外三种候选方案收益更高

| 候选 | 用户收益 | 实施风险 | 当前判定 |
|---|---|---|---|
| 可回读工具观察 | 直接减少漏证据、重复工具调用、错误结论；覆盖代码、文档、MCP、Web、测试日志 | 中；复用现有 archive 与 compactor | **本计划实施** |
| 次级模型日志摘要 | 可缩短超长测试日志 | 高；增加延迟、成本、隐私和模型路由 | 暂不做，待本计划有真实 recall 指标后再评估 |
| Cache-aware 全会话压缩 | 可能降低长会话成本 | 中高；AgenticX 已有 compactor、overflow retry、journal、prompt cache telemetry | 不是当前最高体验缺口 |
| 写入后自动执行验证 | 可省一个模型回合 | 高；与 diff 确认、命令风险门、OS sandbox 耦合 | 不进入本计划 |

### 1.3 已有能力，不重复建设

- `agenticx/runtime/tool_result_budget.py`
  - 已按 session 将大结果归档到 `~/.agenticx/sessions/<session>/tool_archives/`。
  - 已在旧结果超过 `keep_rounds` 后投影 `[tool-result-archived]` 摘要。
- `agenticx/runtime/compactor.py`
  - 已有 `micro_compact_tool_result()`，默认约 4000 字符。
  - `show_widget` 保持完整；`query_data_source` 有结构化专项压缩。
- `agenticx/runtime/replay_ledger/recorder.py`
  - `RuntimeEvent.private_data["raw_result"]` 已写入 replay blob，供审计/回放。
- `agenticx/runtime/compaction_journal.py`
  - 已有压缩 start/end 与孤儿锁恢复，比候选上游的 session-only 状态更强。
- `agenticx/runtime/prompt_cache_policy.py`、`usage_store.py`、`model_pricing.py`
  - 已有前缀缓存、真实 cached token 和成本数据；本计划不另造计费模型。

本计划只补“原文归档之后，模型如何安全找到并精确取回”这一断点。

---

## 2. 根因与证据链

### 2.1 当前主路径在首次下一轮前已不可逆丢失中间内容

`agenticx/runtime/agent_runtime.py` 约 6559–6586：

```python
result = await self.hooks.run_after_tool_call(tool_name, result, session)
raw_result = str(result)
...
archive_path = archive_tool_result(..., content=raw_result, ...)
result = self.compactor.micro_compact_tool_result(tool_name, raw_result)
record_tool_result_meta(..., content=raw_result, archive_path=archive_path)
```

随后约 6701–6727 将 `result`（已经 micro-compact）写入：

- 当前 `messages`
- `session.agent_messages`
- `session.chat_history`

所以模型下一轮和恢复后的会话只看到头尾压缩文本。原文虽然在 archive 和 replay blob 里，但上下文没有稳定的框架工具协议去读取它。

### 2.2 `keep_rounds=8` 不能恢复已经在第一轮被截掉的内容

`agenticx/runtime/tool_result_budget.py` 约 212–287 的 `apply_tool_result_budget()` 只负责把“旧的大结果”进一步替换成摘要。它收到的 message content 已经是 `micro_compact_tool_result()` 的产物，无法恢复中间原文。

此外：

- `ToolResultMeta` 只存在 session 内存属性 `_tool_result_meta`；
- session 重启后，旧消息仍是 micro-compact 文本，但 metadata 不会从 archive 重建；
- `[tool-result-archived]` 暴露的是本机绝对路径，不是受 session 约束的工具引用协议。

### 2.3 仓库内已有真实用户体验证据

- `bugs/没有按照指令实现.md`：
  - 多次出现 `[micro-compact tool=bash_exec original_chars=...]`；
  - 大目录扫描和统计结果中间段被省略；
  - 文件标题本身记录了最终体验：“没有按照指令实现”。
- `docs/perf/tool-loop-baseline-2026-05-24-mattpocock.md`：
  - 30 个 assistant rounds、40 个 tool calls；
  - 同一约 6464 字符内容出现 `file_read → bash_exec → file_read`；
  - 三次结果都只保留约 689 tokens 的 micro-compact 版本；
  - 基线直接证明“原文不可回读”会与重复工具调用同时出现。
- `tests/test_smoke_search_references.py` 已承认：
  - compacted JSON 会导致 `json.loads` 失败；
  - 因此 structured references 必须从 `raw_result` 解析。

### 2.4 两条工具结果路径目前不一致

除主循环外，`agenticx/runtime/agent_runtime.py::_eager_knowledge_search_events()` 约 2683–2803 也直接调用 `micro_compact_tool_result()`，但没有走 `archive_tool_result()` / `record_tool_result_meta()`。若只修主循环，KB “始终检索”首轮仍没有回读句柄。

### 2.5 重复只读结果会被错误计为新进展

`agenticx/runtime/agent_runtime.py` 约 6631–6687：

- `PROGRESS_TOOLS` 包含 `bash_exec`、`file_read`、`list_files`、`web_search` 等；
- 只要调用成功、结果超过 10 字符，就会设置 `logical_progress=True`；
- `LoopDetector.record_call()` 因此收到 `has_progress=True`，即使同一参数刚刚返回过完全相同的原文。

`agenticx/runtime/loop_detector.py` 约 39–53、136–163：

- 只保存 `(tool_name, args_signature)` 与布尔 progress；
- `_last_success_fingerprint` 仅提取前 6000 字符里的路径/URL，用于生成短 nudge；
- 没有保存完整原始结果摘要，也无法判断“同参数 + 同证据”。

这意味着重复读取会持续为任务“续命”，削弱 `no_progress` / `tool_saturation`，直到更晚的 generic repeat 阈值才被发现。新增 observation hash 后，可以无额外模型调用地判定完全相同证据。

---

## 3. 产品价值与成功指标

### 3.1 用户可感知结果

- Agent 在大型命令、文件或 MCP 返回中漏掉中间关键证据时，不再从头重跑工具，而是精确回读。
- 会话重启后继续任务，仍可根据历史中的 observation id 取回上次原文。
- 工具卡保持紧凑，不把数万行日志直接铺进聊天。
- 归档失败时体验不倒退：仍沿用当前 micro-compact，不阻塞回答。
- 不新增外部模型调用，不增加隐私出网，不改变用户确认次数。

### 3.2 可执行指标

| 指标 | 基线 | 本计划门槛 |
|---|---|---|
| 64 KiB 工具结果进入模型的投影大小 | 约 4 KiB，且无框架回读 id | 不超过现有 compact 文本 + 768 字符，包含稳定 id |
| 原文恢复率 | 无正式回读协议 | 从 offset 0 按 `next_offset` 分页拼接，UTF-8 字节 **100% 相同** |
| 重启后回读 | 内存 metadata 丢失 | 新建同 session id 的 session 对象仍可回读 |
| 跨 session 读取 | 绝对路径可能被模型看到 | 仅 id，另一个 session 返回 unknown observation |
| 大结果归档失败 | 当前可能静默无 path | 工具主结果继续，投影退回现有 micro-compact |
| 回读结果递归压缩 | 无该工具 | `tool_result_recall` 输出不被再次 micro-compact 或 observation-wrap |
| 结构化工具回归 | 部分依赖完整 JSON | `show_widget`、`query_data_source`、图片工具和 structured references 语义不变 |
| 重复只读调用进展 | 成功且结果 >10 字符即算进展 | 同工具 + 同参数 + 同 raw SHA-256 的第二次结果 `has_progress=False`，并生成复用/回读 nudge |

---

## 4. 范围

### In scope

- 当前 session 下内容寻址的大工具结果对象。
- 大工具结果紧凑投影协议。
- `tool_result_recall` 内置只读工具。
- offset 分页与字面量 query 搜索。
- 主工具循环与 eager knowledge search 共用接线。
- 对并发安全/只读工具做“同参数 + 同原文”重复证据判定。
- session 重启、UTF-8、symlink、哈希完整性、跨 session 隔离测试。
- context stats 增加可观测字段，便于后续量化收益。
- 更新 `conclusions/runtime_module_conclusion.md`（实施完成后通过 `/update-conclusion` 流程）。

### Out of scope

- 远程/本地次级 LLM 日志 reducer。
- 全会话压缩触发算法、cache write/read 经济门。
- `file_write + bash_exec` Action Fusion。
- Desktop 新面板、设置项或工具卡视觉重构。
- replay ledger 存储格式重构。
- 删除或迁移 legacy `tool_archives/r<round>-<call>-<tool>.txt`。
- 清理当前未调用的 `_maybe_persist_large_tool_result()`。
- 修改 `agenticx/studio/server.py`。
- Enterprise、移动端、IM 协议。

### No-scope-creep 边界

1. 不改变工具执行、确认、沙箱、Hook 顺序；只处理 `run_after_tool_call` 之后的结果投影。
2. 不把绝对 archive path 继续暴露给模型；新投影只给 observation id。
3. 不给任意工具默认套 wrapper。v1 只覆盖明确的大文本工具 allowlist。
4. 不把 recall 结果永久写回原 archive 的新对象，避免递归归档。
5. 不为本计划增加 Desktop 配置；复用现有 `runtime.tool_result_budget.enabled` / `AGX_TOOL_RESULT_BUDGET_ENABLED` 总开关。
6. 不在 dispatch 前跳过工具执行：文件或命令结果可能因外部状态变化而改变。只有工具真实执行后，且 raw SHA-256 仍相同，才判定“没有新进展”。
7. 不对写工具、非只读 shell、Computer Use、远程发布或其它有副作用工具做重复证据降级。

---

## 5. 协议与数据设计

### 5.1 Observation id 和磁盘布局

新增常量与校验：

```python
OBSERVATION_ID_RE = re.compile(r"^obs_[a-f0-9]{64}$")
SAFE_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
OBSERVATION_PREFIX = "[tool-result-observation]"
OBSERVATION_TOOLS = frozenset({
    "bash_exec",
    "bash_bg_poll",
    "file_read",
    "liteparse",
    "mcp_call",
    "web_fetch",
    "web_search",
    "code_search",
    "knowledge_search",
})
```

`observation_id = "obs_" + sha256(raw_utf8_bytes).hexdigest()`。

当前会话标识通过统一 helper 解析，优先级固定为：

```python
_session_id -> session_id -> _owner_session_id
```

其中委派分身在 `agenticx/runtime/meta_tools.py::_find_or_create_avatar_session()` 与 `_run_delegation_in_avatar_session()` 只显式设置 `_owner_session_id = avatar_managed.session_id`；这里的 `_owner_session_id` 实际指向该分身自己的 managed session，不是父 Meta session。不得漏掉此 fallback，也不得回退到工作区路径或 avatar id。

新对象落点：

```text
~/.agenticx/sessions/<safe-session-id>/tool_archives/
└── objects/
    └── <hash前2位>/
        └── <64位hash>.txt
```

规则：

- 同一 session 内相同原文只存一份。
- observation 新路径只接受 `SAFE_SESSION_ID_RE` 命中的真实 session id；不把不安全 id 替换成可能碰撞的下划线形式。
- 创建目录使用 0700；新对象使用 0600。
- 对 `tool_archives/objects/<prefix>` 各层做 `lstat` / resolved-root 校验，拒绝 symlink 目录和路径逃逸。
- 新对象用 exclusive create；若已存在，必须验证普通文件、非 symlink、长度与 SHA-256。
- 任一完整性检查失败，不生成句柄，退回旧行为。
- recall 通过 id 推导当前 session 内对象路径，不接受调用者提供 path。
- 普通 Meta、Avatar 委派、Automation 等只要能解析出安全 session id，均使用自己的 session 目录；测试必须证明两个 avatar managed session 不能互读。

### 5.2 紧凑投影格式

当且仅当：

- `runtime.tool_result_budget.enabled == true`；
- `tool_name in OBSERVATION_TOOLS`；
- 原始结果实际被 `micro_compact_tool_result()` 改短；
- 原文对象成功落盘；

将当前 compact 文本包装为：

```text
[tool-result-observation]
id=obs_<64hex>
tool=<tool_name>
original_chars=<N>
original_bytes=<N>
projected_chars=<N>
recall=call tool_result_recall with {"id":"obs_<64hex>","query":"literal"} to find exact evidence, or {"id":"obs_<64hex>","offset_bytes":0} to page the original
<现有 micro_compact_tool_result 输出，原样>
```

不满足条件时返回现有 compact 文本，不加伪句柄。

旧结果超过 `keep_rounds` 时，`_build_archived_summary()` 必须保留：

- observation id；
- recall 指令；
- 原始字符数；
- 一行摘要；

不得退化回绝对 `archive_path`。

Observation wrapper 的老化不能继续依赖 `current_round - meta.round_idx`：两个值都是单次 `run_turn` 内轮次，下一条用户消息会从头计数。对含 `[tool-result-observation]` 的消息，`apply_tool_result_budget()` 必须从当前 `messages` 尾部反向统计其后出现的 assistant 消息数量，作为 provider-visible age：

```python
assistant_count = 0
for index in range(len(messages) - 1, -1, -1):
    age_by_index[index] = assistant_count
    if messages[index].get("role") == "assistant":
        assistant_count += 1
```

- wrapper 中直接解析 observation id / original chars，不要求 `_tool_result_meta` 仍在内存；
- 因此跨用户 turn、`agx serve` 重启后仍可老化成更短 stub；
- legacy 非 observation 消息继续走原有 meta/round 逻辑，本计划不扩大兼容面；
- batch threshold 按“可从当前 provider 投影移除的 projected tokens”计算，不能按 raw 原文大小虚报节省。

### 5.3 `tool_result_recall` schema

在 `agenticx/cli/agent_tools.py` 注册：

```json
{
  "name": "tool_result_recall",
  "description": "Recall exact text from a previously compacted tool result in the current session...",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {"type": "string"},
      "offset_bytes": {"type": "integer", "minimum": 0},
      "query": {"type": "string", "minLength": 1, "maxLength": 256},
      "context_lines": {"type": "integer", "minimum": 0, "maximum": 3}
    },
    "required": ["id"],
    "additionalProperties": false
  }
}
```

互斥语义：

- `query` 非空时禁止同时显式传 `offset_bytes`。
- 两者都不传时等价于 `offset_bytes=0`。

分页模式：

- 最多返回 3072 原文 bytes、200 行。
- 只接受 0 或上一次返回的 `next_offset` 所指向的 UTF-8 边界；任意 continuation-byte offset 返回明确错误。
- Header：

```text
[tool_result_recall id=<id> offset=<actual> next_offset=<N> eof=<true|false>]
[chunk_bytes=<N> chunk_lines=<N>]
```

搜索模式：

- 只做 case-insensitive 字面量搜索，不接受 regex。
- 逐行流式扫描对象，不用 `read_text()` 一次性把超大日志载入内存。
- 返回前 20 个匹配，按原文行号排序，每个匹配带 `context_lines`（默认 2，上限 3）。
- 去重重叠上下文窗口。
- 总输出仍受 3072 bytes / 200 行硬限制；超出时给 `truncated=true`。
- 没匹配时返回 `matches=0`，不得抛“unknown observation”。

### 5.4 Tool Search 与递归保护

- `agenticx/runtime/tool_search.py::CORE_ALWAYS_LOAD_TOOLS` 加入 `tool_result_recall`。
- 理由：历史紧凑结果会直接指示模型调用它；若被 deferred，模型需额外一轮先加载，抵消收益。
- `agenticx/runtime/compactor.py::micro_compact_tool_result()` 对 `tool_result_recall` 直接返回原文。
- `prepare_tool_result_observation()` 对 `tool_result_recall` 跳过归档和 wrapper，但仍记录普通 tool token/meta，避免低估上下文用量。
- recall 单次输出硬限制保证不会无限污染上下文。

### 5.5 结构化结果兼容

以下保持当前语义：

- `show_widget`：完整 JSON，不归档、不 wrapper。
- `query_data_source`：继续走 `_compact_query_data_source_result()`，v1 不加 observation wrapper。
- `generate_image` / `show_images` / `desktop_screenshot`：不进入文本 observation allowlist。
- `structured_payload_for_tool_result(...)`：继续传 `raw_result`，禁止改成 projected result。
- `RuntimeEvent.private_data["raw_result"]`：继续保留完整原文，Replay Ledger 行为不变。

### 5.6 重复证据进展协议

`LoopDetector` 新增当前 turn 内的结果摘要表：

```python
_last_result_digests: Dict[Tuple[str, str], str]
```

新增纯判定：

```python
def has_seen_result(
    self,
    tool_name: str,
    args_signature: str,
    result_digest: str,
) -> bool:
    ...
```

并让 `record_call(..., result_digest=None)` 在记录本次调用后更新摘要表；`reset()` 必须清空。

Runtime 判定顺序：

1. 对非错误 `raw_result` 算完整 SHA-256，不能用 micro-compact 文本或路径/URL fingerprint。
2. `args_signature` 继续使用模型原始 `arguments`，不能包含运行时注入的 `__tool_call_id`。
3. 仅当 `studio_tool_is_concurrency_safe(tool_name, arguments)` 为真时检查重复：
   - 普通只读工具由现有 allowlist 判定；
   - `bash_exec` 复用 `_bash_exec_is_read_only()` 的安全分类；
   - 写入/外部发布/Computer Use 不参与。
4. 若 `(tool_name, args_signature, result_digest)` 已见：
   - `duplicate_evidence=True`；
   - 仅把 `logical_progress` 降为 false，不覆盖 `disk_write_progress` 等副作用进展；
   - 设置一次高信号 pending nudge：若本次有 observation id，明确调用 `tool_result_recall`；否则要求复用上一条 tool result；
   - 仍把本次真实结果写入历史，保持执行事实完整。
5. `tool_result_recall` 的不同 offset/query 参数属于新进展；完全相同参数返回相同 chunk 时同样判为重复。

该协议不做跨 turn 自动去重。跨 turn 的安全跳过需要文件版本、命令副作用与外部资源新鲜度模型，超出本计划。

---

## 6. 精确改动落点

### 6.1 `agenticx/runtime/tool_result_budget.py`

**Anchors:** `ToolResultBudgetConfig`、`ToolResultMeta`、`archive_tool_result()`、`record_tool_result_meta()`、`_build_archived_summary()`、`apply_tool_result_budget()`。

新增：

- `ToolResultObservation` frozen dataclass：
  - `observation_id: Optional[str]`
  - `archive_path: Optional[Path]`
  - `raw_chars`
  - `raw_bytes`
  - `projected_text`
  - `projected_chars`
- `_observation_id(raw_text)`
- `_observation_object_path(session, observation_id, cfg)`
- `archive_tool_observation(...)`
- `build_tool_observation_projection(...)`
- `prepare_tool_result_observation(...)`
- `recall_tool_observation(...)`
- UTF-8 分页与 literal search 私有辅助函数。

修改：

- `ToolResultMeta` 增加 `observation_id: Optional[str] = None`。
- `record_tool_result_meta(..., observation_id=None)`。
- `_build_archived_summary()` 优先输出 observation id + recall 指令，不输出绝对 path；无 observation id 的 legacy meta 保持旧格式。
- `apply_tool_result_budget()` 识别 `[tool-result-observation]`，老化后仍保留 recall id。
- 对 observation wrapper 使用“后随 assistant 数”计算 age；即使 `_tool_result_meta` 为空也能跨 turn/重启老化。

兼容约束：

- 保留 `archive_tool_result()` 现有函数签名和返回 `Optional[Path]`，供已有调用和测试使用；新主路径改用 `prepare_tool_result_observation()`。
- legacy 文件不迁移、不删除。

### 6.2 `agenticx/runtime/compactor.py`

**Anchor:** `ContextCompactor.micro_compact_tool_result()` 约 377–405。

Before：

```python
if name == "show_widget":
    return str(result or "")
```

After intent：

```python
if name in {"show_widget", "tool_result_recall"}:
    return str(result or "")
```

其余预算、`query_data_source` 专项逻辑完全不动。

### 6.3 `agenticx/cli/agent_tools.py`

**Anchors:**

- 顶部 import 区；
- `STUDIO_TOOLS` 的 `file_read` schema 约 978；
- `dispatch_tool_async()` 的 `file_read` 分支约 9602–9605。

修改：

1. 顶部从 `agenticx.runtime.tool_result_budget` 导入 `recall_tool_observation`，禁止函数内 inline import。
2. 在 `file_read` 后增加 `tool_result_recall` schema。
3. 新增 `_tool_result_recall(arguments, session)` 薄封装：
   - 解析参数；
   - 调 `recall_tool_observation()`；
   - 将 `ValueError` / `FileNotFoundError` 变成 `ERROR:` 可操作文案。
4. 在 dispatch 的 `file_read` 后增加：

```python
if name == "tool_result_recall":
    return _tool_result_recall(arguments, session)
```

该工具只读，不走 confirm gate，不接受 path。

### 6.4 `agenticx/runtime/tool_search.py`

**Anchor:** `CORE_ALWAYS_LOAD_TOOLS` 约 36–68。

加入 `"tool_result_recall"`；不得调整其他工具顺序或 defer allowlist。

### 6.5 `agenticx/runtime/loop_detector.py`

**Anchors:** `LoopDetector.__init__()` 约 29–44、`reset()` 约 46–53、`record_call()` 约 136–153。

修改：

- 增加 `_last_result_digests`。
- 增加 `has_seen_result()`。
- `record_call()` 新增可选 `result_digest` 并在尾部记录。
- `reset()` 清空 digest。
- 不改 warning/critical 默认阈值、不改现有 detector 顺序。

### 6.6 `agenticx/runtime/agent_runtime.py`

**Anchors:**

- 顶部 `tool_result_budget` imports 约 51–59；
- 顶部 `agent_tools` imports 约 36–45，增加 `studio_tool_is_concurrency_safe`；
- `_eager_knowledge_search_events()` 约 2683–2803；
- 主循环工具结果处理约 6559–6586；
- 主循环局部 `PROGRESS_TOOLS` 约 6631–6638；
- message/chat_history 追加约 6701–6727；
- `context_payload` 约 4110–4135。

新增私有 helper（放在 `_eager_knowledge_search_events` 前，避免两条路径复制）：

```python
def _prepare_tool_result_for_context(
    *,
    runtime: "AgentRuntime",
    session: Any,
    round_idx: int,
    tool_call_id: str,
    tool_name: str,
    raw_result: str,
    budget_cfg: ToolResultBudgetConfig,
) -> ToolResultObservation:
    compacted = runtime.compactor.micro_compact_tool_result(tool_name, raw_result)
    return prepare_tool_result_observation(
        session,
        round_idx=round_idx,
        tool_call_id=tool_call_id,
        tool_name=tool_name,
        raw_text=raw_result,
        compacted_text=compacted,
        cfg=budget_cfg,
    )
```

接线：

- 主循环：
  - 删除手写 `get_result_class → archive_tool_result → micro_compact → record_meta` 重复段；
  - 改成 helper；
  - `result = observation.projected_text`；
  - 后续 progress、loop detector、messages、chat history 均继续使用 projected `result`；
  - structured payload、content block、Replay private_data 继续使用 `raw_result`。
  - `PROGRESS_TOOLS` 加入 `tool_result_recall`，使分页/搜索回读计为认知进展。
  - 在 `LoopDetector.record_call()` 前按 5.6 判定 `duplicate_evidence`；相同只读证据不得让 `logical_progress=True`。
- eager knowledge：
  - 获取同一 `budget_cfg`；
  - 也走 helper；
  - 追加完整 metadata；
  - 保持 structured payload 从 raw result 解析。
- session 内累计：
  - `_tool_observations_created`
  - `_tool_observation_bytes_original`
  - `_tool_observation_bytes_projected`
  - `_tool_observation_recall_calls`
- `context_payload` 新增同名累计字段和：
  - `tool_observation_bytes_avoided = original - projected`

上述 bytes 均按“每次逻辑工具观察”累计，而非磁盘去重后的物理占用；相同原文复用同一对象时，仍分别计算每次 provider 投影节省。

失败语义：

- archive/projection 任一步异常只记 warning；
- 返回 `ToolResultObservation(observation_id=None, projected_text=compacted, ...)`；
- 不允许因优化机制让工具结果丢失或本轮失败。

### 6.7 测试文件

新增 `tests/test_tool_result_observations.py`：

- 内容寻址对象与幂等写。
- 不同 session 隔离。
- symlink / hash mismatch fail-closed，主投影 fail-open。
- UTF-8 分页完整拼回。
- 搜索模式 literal、上下文、去重、硬上限。
- unknown id、非法 id、越界 offset、非 UTF-8 边界。
- recall 不递归 wrapper。

修改 `tests/test_tool_result_budget.py`：

- `ToolResultMeta.observation_id`。
- 老化 summary 保留 id 和 recall 指令。
- 重建一个没有 `_tool_result_meta` 的 session，含 observation wrapper 的旧消息仍按后随 assistant 数老化。
- legacy archive path 测试仍通过。

修改 `tests/test_smoke_cc_stability_m2.py`：

- 继续断言普通 `file_read` micro compact。
- 新增 `tool_result_recall` 不被 micro compact。

修改 `tests/test_agent_runtime_tool_search.py`：

- `tool_result_recall` 在 adaptive/always 模式均始终加载。

新增 `tests/test_agent_runtime_tool_observation.py`：

- 用 fake dispatch + fake LLM 驱动一条 64 KiB `bash_exec`。
- 断言：
  - LLM 下一轮收到 compact + observation id；
  - `session.agent_messages` / `chat_history` 保存同一 projected text；
  - `RuntimeEvent.data.result` 为 projected text；
  - `RuntimeEvent.private_data.raw_result` 仍是 64 KiB；
  - 调 `tool_result_recall(query="MIDDLE_SENTINEL")` 得到精确 sentinel；
  - 不重新执行原 `bash_exec`。

修改 `tests/test_loop_detector.py`：

- 同 tool + 同 args + 同 digest 的第二次可被 `has_seen_result()` 识别。
- 同 args 但不同 digest 仍是新证据。
- `reset()` 清空 digest。

新增 `tests/test_agent_runtime_duplicate_evidence.py`：

- 同参数 `file_read` 两次返回相同 raw：第二次 `has_progress=False` 并生成 observation recall nudge。
- 同参数 `file_read` 在文件变化后 raw digest 不同：仍 `has_progress=True`。
- 同只读 `bash_exec` + 同 raw：第二次不算进展。
- 非只读 `bash_exec` 与 `file_write` 即使返回文本相同也不被该规则降级。
- `tool_result_recall` 不同 offset 连续分页均算进展；完全重复同一 offset 才不算。

修改 `tests/test_smoke_kb_force_first_round.py`：

- eager `knowledge_search` 长结果也生成 observation id。
- `structured_payload_for_tool_result` 仍从完整 raw JSON 得到 references。

保留并回归：

- `tests/test_smoke_search_references.py`
- `tests/test_smoke_turn_prefix_stability.py`
- `tests/test_tool_result_budget_defaults.py`
- `tests/test_smoke_overflow_compact_retry.py`

---

## 7. TDD 实施任务

### Task 1：锁定 observation 存储与回读契约

**Files**

- Create: `tests/test_tool_result_observations.py`
- Modify: `agenticx/runtime/tool_result_budget.py`

**Red**

先写以下失败测试：

1. `test_content_addressed_observation_is_idempotent`
2. `test_observation_is_scoped_to_current_session`
3. `test_recall_pages_round_trip_utf8_bytes_exactly`
4. `test_recall_literal_search_returns_exact_context`
5. `test_recall_rejects_symlink_object`
6. `test_projection_falls_back_when_archive_fails`
7. `test_observation_ages_by_following_assistant_messages_without_memory_meta`

Run：

```bash
pytest -q tests/test_tool_result_observations.py
```

Expected：因 `prepare_tool_result_observation` / `recall_tool_observation` 不存在而失败。

**Green**

按第 5 节实现最小存储、投影、分页和搜索；不得先接 runtime。

**Verify**

```bash
pytest -q tests/test_tool_result_observations.py tests/test_tool_result_budget.py
```

Expected：全部通过。

### Task 2：注册始终可用的只读回读工具

**Files**

- Modify: `agenticx/cli/agent_tools.py`
- Modify: `agenticx/runtime/tool_search.py`
- Modify: `agenticx/runtime/compactor.py`
- Modify: `tests/test_agent_runtime_tool_search.py`
- Modify: `tests/test_smoke_cc_stability_m2.py`

**Red**

1. tool schema 存在且只接受 id/offset/query/context_lines。
2. adaptive Tool Search 下仍立即可见。
3. recall 输出不被 micro compact。
4. 跨 session id 返回 unknown。

**Green**

按 6.2–6.4 实现，不改 confirm/sandbox/其它工具顺序。

**Verify**

```bash
pytest -q \
  tests/test_agent_runtime_tool_search.py \
  tests/test_smoke_cc_stability_m2.py \
  tests/test_tool_result_observations.py
```

Expected：全部通过。

### Task 3：统一主循环与 eager knowledge 工具结果接线

**Files**

- Modify: `agenticx/runtime/agent_runtime.py`
- Create: `tests/test_agent_runtime_tool_observation.py`
- Modify: `tests/test_smoke_kb_force_first_round.py`

**Red**

先写 64 KiB + `MIDDLE_SENTINEL` 集成测试，证明当前下一轮只有 micro-compact、没有 id、不能框架回读。

**Green**

实现 `_prepare_tool_result_for_context()` 并替换两处直接 micro-compact 路径。

关键断言：

- `raw_result` 只用于 archive / structured payload / private replay。
- `projected_text` 只用于模型消息 / chat history /公开 TOOL_RESULT。
- `tool_result_recall` 自身不会生成新 observation。
- 把 `tool_result_recall` 加入主循环局部 `PROGRESS_TOOLS`；不同 offset/query 的精确回读属于有效认知进展，不能被 LoopDetector 误判为无进展重复。

**Verify**

```bash
pytest -q \
  tests/test_agent_runtime_tool_observation.py \
  tests/test_smoke_kb_force_first_round.py \
  tests/test_smoke_search_references.py
```

Expected：全部通过。

### Task 4：重复只读证据不再刷新进展

**Files**

- Modify: `agenticx/runtime/loop_detector.py`
- Modify: `agenticx/runtime/agent_runtime.py`
- Modify: `tests/test_loop_detector.py`
- Create: `tests/test_agent_runtime_duplicate_evidence.py`

**Red**

1. 同 `file_read` 参数和同 raw digest 的第二次结果，当前实现仍得到 `logical_progress=True`。
2. 同只读 `bash_exec` + 同 raw 仍刷新 progress。
3. 文件内容变化导致 digest 变化时，必须仍算新进展。
4. 写工具不能被重复证据逻辑降级。
5. 连续按不同 `next_offset` 分页时均算进展；重复同一 offset 的同一 chunk 不算新进展。

**Green**

按 5.6 实现 digest 记忆与 runtime 判定。只影响 LoopDetector 的 `has_progress` 和 pending nudge，不跳过真实 dispatch、不修改工具结果。

**Verify**

```bash
pytest -q \
  tests/test_loop_detector.py \
  tests/test_agent_runtime_duplicate_evidence.py \
  tests/test_near_stuck_prevention.py \
  tests/test_loop_halt_progress.py
```

Expected：全部通过。

### Task 5：补可观测指标与重启恢复测试

**Files**

- Modify: `agenticx/runtime/tool_result_budget.py`
- Modify: `agenticx/runtime/agent_runtime.py`
- Modify: `tests/test_agent_runtime_tool_observation.py`
- Modify: `tests/test_tool_result_observations.py`

**Red**

1. 新 `StudioSession` 对象复用同一 session id 后可回读。
2. `context_stats` 统计 created/original/projected/avoided/recall calls。
3. 归档失败计数不把 created 加一。

**Green**

仅增加 session 累计字段和 context payload；不要新增 SQLite 表或 Desktop 展示。

**Verify**

```bash
pytest -q \
  tests/test_tool_result_observations.py \
  tests/test_agent_runtime_tool_observation.py \
  tests/test_smoke_turn_prefix_stability.py
```

Expected：全部通过。

### Task 6：定向回归与产品级验收

**Files**

- No production files unless a test exposes本计划直接引入的回归。

Run：

```bash
pytest -q \
  tests/test_tool_result_observations.py \
  tests/test_tool_result_budget.py \
  tests/test_tool_result_budget_defaults.py \
  tests/test_smoke_turn_prefix_stability.py \
  tests/test_agent_runtime_tool_observation.py \
  tests/test_agent_runtime_tool_search.py \
  tests/test_loop_detector.py \
  tests/test_agent_runtime_duplicate_evidence.py \
  tests/test_smoke_cc_stability_m2.py \
  tests/test_smoke_kb_force_first_round.py \
  tests/test_smoke_search_references.py \
  tests/test_smoke_overflow_compact_retry.py
```

然后：

```bash
ruff check \
  agenticx/runtime/tool_result_budget.py \
  agenticx/runtime/compactor.py \
  agenticx/runtime/loop_detector.py \
  agenticx/runtime/tool_search.py \
  agenticx/runtime/agent_runtime.py \
  agenticx/cli/agent_tools.py \
  tests/test_tool_result_observations.py \
  tests/test_agent_runtime_tool_observation.py \
  tests/test_agent_runtime_duplicate_evidence.py
```

产品级 deterministic scenario：

1. fake `bash_exec` 返回 64 KiB，头部/尾部没有 `MIDDLE_SENTINEL`。
2. 第一次投影不超过 `micro_compact + 768 chars`。
3. 从投影解析 observation id。
4. 新 session 实例调用：

```json
{"id":"obs_<hash>","query":"MIDDLE_SENTINEL","context_lines":2}
```

5. 断言一次回读即命中 sentinel，原 bash dispatch call count 仍为 1。

禁止用真实付费模型作为 Go/No-Go 必要条件。

---

## 8. FR / NFR / AC

### Functional Requirements

- **FR-1**：大型文本工具结果在有损投影前归档为当前 session 的内容寻址对象。
- **FR-2**：紧凑投影必须携带稳定 observation id、原始大小和回读指令。
- **FR-3**：`tool_result_recall` 支持精确分页和字面量搜索。
- **FR-4**：主工具循环与 eager knowledge search 使用同一准备函数。
- **FR-5**：session 重启后无需内存 metadata 即可回读。
- **FR-6**：旧结果老化后仍保留 observation id，不暴露绝对路径。
- **FR-7**：structured references 与 Replay Ledger 继续消费完整 raw result。
- **FR-8**：归档/投影异常 fail-open 到现有 micro-compact 行为。
- **FR-9**：同参数只读工具返回同一 raw digest 时不再刷新 LoopDetector 进展，并提示复用 observation。
- **FR-10**：委派 Avatar 仅有 `_owner_session_id` 时仍使用自己的 managed session 归档与回读。
- **FR-11**：observation wrapper 的老化基于消息位置，不依赖单 turn `round_idx` 或内存 meta。

### Non-Functional Requirements

- **NFR-1 安全**：recall 不接受 path；严格 current-session scope；拒绝 symlink 与 hash mismatch。
- **NFR-2 兼容**：零新增依赖；旧 archive 不迁移；工具确认与 sandbox 不变。
- **NFR-3 预算**：公开投影最多比现有 compact 文本增加 768 字符；单次 recall 原文不超过 3072 bytes / 200 lines。
- **NFR-4 确定性**：相同 UTF-8 bytes 生成相同 id；分页拼接 100% 还原。
- **NFR-5 可观测**：context stats 能算出原始、投影、避免的逻辑 bytes 与 recall 次数。
- **NFR-6 失败隔离**：优化层失败不能把成功工具调用变成 ERROR。
- **NFR-7 副作用安全**：重复证据判定不得跳过真实 dispatch，也不得降级写工具或非只读 shell 的进展。

### Acceptance Criteria

- **AC-1 / FR-1, FR-2**：64 KiB `bash_exec` 生成 `obs_<64hex>`；对象字节等于 raw；模型投影含 recall 指令。
- **AC-2 / FR-3**：offset 0 开始循环 `next_offset`，最终 bytes 与 raw 完全一致；包含多字节中文与组合字符。
- **AC-3 / FR-3**：query 搜索能在头尾均不含 sentinel 时，一次返回 sentinel 与 ±2 行原文。
- **AC-4 / FR-5**：销毁内存 session/meta，重建同 session id 后仍可回读；不同 session id 不可读。
- **AC-5 / FR-6**：`keep_rounds` 老化投影仍含 id；无绝对 archive path。
- **AC-6 / FR-7**：`tests/test_smoke_search_references.py` 和 eager KB reference 测试继续通过。
- **AC-7 / FR-8**：只读目录、写盘异常、完整性失败时返回旧 micro-compact；工具主结果状态不变。
- **AC-8 / NFR-1**：非法 id、symlink、跨 session、offset 越界都有明确错误且不泄漏磁盘路径。
- **AC-9 / NFR-3**：recall 输出不会被二次 micro-compact 或再次 observation-wrap。
- **AC-10 产品收益**：deterministic scenario 中原工具仅执行一次，模型通过一次 recall 获取中间证据。
- **AC-11 / FR-9**：相同只读调用第二次返回相同 digest 时 `has_progress=False` 且 nudge 含 observation id；不同 digest 仍为 true。
- **AC-12 / FR-10**：两个仅设置各自 `_owner_session_id` 的 Avatar session 均能回读自己的对象，且互相返回 unknown observation。
- **AC-13 / NFR-7**：`file_write` 和非只读 `bash_exec` 不经过重复证据降级。
- **AC-14 / FR-11**：跨用户 turn / 重启模拟中 `_tool_result_meta={}`，超过 `keep_rounds` 的 wrapper 仍变成含同一 id 的短 stub。

---

## 9. 发布、回滚与兼容

### 发布

- 复用现有 `runtime.tool_result_budget.enabled`，不增加新的用户设置。
- 现有默认值为 enabled，因此通过测试后新句柄默认生效，用户无需配置。
- observation 只在结果实际被缩短且归档成功时出现；小结果行为零变化。

### 回滚

即时回滚：

```bash
export AGX_TOOL_RESULT_BUDGET_ENABLED=0
```

或在 `~/.agenticx/config.yaml`：

```yaml
runtime:
  tool_result_budget:
    enabled: false
```

回滚后：

- 继续使用现有 `micro_compact_tool_result()`；
- 已写入的 `objects/` 可留存，不影响旧会话；
- 不删除数据，不需要 migration down。

### 向后兼容

- 已有历史没有 observation id，保持不可回读，不伪造迁移。
- 已有 legacy `r<round>-...txt` 继续由原逻辑识别。
- API / SSE event type 不变；只增加 result 内可读 metadata 与 context stats 字段。
- Desktop 不需要同步升级即可继续显示工具卡。

---

## 10. Go / No-Go

### Go

- 全部 AC 对应测试通过。
- 定向回归全绿。
- 64 KiB 原文分页还原 100%。
- archive 失败时工具调用仍成功。
- `show_widget` / `query_data_source` / 图片 / structured references 零回归。
- 新 tool 在 Tool Search adaptive 模式首轮可用。
- 相同只读证据不再刷新 progress；内容变化和有副作用工具仍按原逻辑计算。
- Avatar managed session 通过 `_owner_session_id` fallback 完成隔离归档与回读。

### No-Go

- observation id 能跨 session 读取。
- 任意 recall 输出被再次截断或再次生成句柄。
- wrapper 破坏结构化 JSON 工具消费。
- archive 写失败导致本轮 ERROR。
- 重复证据判断跳过了真实工具执行，或误伤写工具/非只读 shell。
- 委派 Avatar 无法生成句柄，或两个 managed session 能互读。
- 模型或 UI 仍只得到绝对磁盘路径。
- 为完成本计划必须修改 `server.py`、Desktop 或确认/沙箱逻辑。

---

## 11. 实施模型分工建议

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| Task 1 存储/分页/搜索与单测 | Composer 2.5 或代码专精中档 | 契约明确、边界测试充分 |
| Task 2 tool schema / dispatch / Tool Search | Composer 2.5 | 机械接线，低歧义 |
| Task 3 `agent_runtime.py` 双路径收口 | GPT-5.6 Sol medium | 文件超大且主循环敏感，需强上下文与回归判断 |
| Task 4 重复证据进展判定 | GPT-5.6 Sol medium | 涉及 LoopDetector 与副作用边界，误判会导致任务倒退 |
| Task 5 stats / restart | Composer 2.5 | 状态字段与测试为主 |
| Task 6 回归与修复 | GPT-5.6 Sol medium | 需要判断是否为本计划引入的真实回归，防 scope creep |

单模型实施时，统一使用 GPT-5.6 Sol medium 最稳妥。Plan 已按 Composer 2.5 无对话上下文可独立实施的最低门槛写全。
