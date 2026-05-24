# Plan: 工具循环上下文预算治理（Tool-Loop Context Budget）

- Plan-Id: 2026-05-24-tool-loop-context-budget
- Plan-File: .cursor/plans/2026-05-24-tool-loop-context-budget.plan.md
- Owner: Damon Li
- Status: Draft

## 背景与问题

多轮工具调用任务（典型如「批量安装 N 个 skill」「批量修复 N 个文件」）在 Machi 元智能体上稳定地长成 30+ 轮、6 小时撞墙的长链路。具体病例与实测见 `docs/perf/tool-loop-baseline-2026-05-24-mattpocock.md`（session `87d99920-b68a-45b3-a77a-0f2a18cc8607`）：

- 用户输入仅 1 句：「介绍一下 https://github.com/mattpocock/skills 这个仓库到底讲的是啥」
- 实际 assistant 轮次 **30**（含 75 条总消息：5 user + 30 assistant + 40 tool）
- 工具调用分布：`bash_exec` × 15、`skill_manage` × 8（其中第 7 轮一次发 4 个，全部 `skill_already_exists`）、`todo_write` × 6、`file_read` × 2、其它 9 次
- 错误信号 20+：`skill_already_exists` × 8、`generic_error` × 12（含 4 次连续的 todo_write 失败）、`walltime_stop` × **3**（撞 `max_wall_clock_hours=6` 不止一次）
- tool_result 累计 tokens **7,249**（注意：这是**已经被 `micro_compact_tool_result` 压缩后**的事后统计，原文规模显著更大；preview 中能直接看到 `[micro-compact tool=file_read original_chars=6464]` 之类标记）
- 模型 think 块的两段自白（已编入历史回放，原文见首部分析）暴露了**最关键**的产品矛盾：

  > 「skill_manage 的 create 操作会创建 SKILL.md 文件。但如果我能直接用 file_write 写入文件，然后... 不行，skill 必须通过 skill_manage 注册。」  
  >   
  > 「直接用 bash_exec 运行一个 Python 脚本... 但等等，skill_manage 是否还会做其他事情（比如在索引中注册）？...如果我直接写入文件，可能不会被系统识别为 skill。」

  模型自己已经推理出最优路径（bash 批量直写），但因 SOP 不确定 `skill_manage` 副作用而**主动放弃**。这不是模型笨，是 prompt 与工具能力共同把 agent 引进了死胡同。

抽象后真正的根因不是某个工具设计差，而是一个**通用病**：

> **多轮 tool loop 中，tool result 在 chat_history 里线性累积 → context 占比指数膨胀 → 原始用户指令的注意力权重被稀释 → 模型偏离主线、重复试错、把简单任务越做越长。**

对照仓库现状，已经存在多个对抗这个病的机制，但分工不平衡：

| 已有机制 | 文件 | 触发性 | 副作用 |
|---------|------|--------|--------|
| `micro_compact_tool_result`（单 result > 4000 chars 压 head/tail） | `agenticx/runtime/compactor.py:143` | 主动，单 result 维度 | **直接改 chat_history，连带改 `messages.json`**（baseline 脚本能直接看到 `[micro-compact ...]` 标记） |
| `Compactor._should_compact`（按总 token / 消息条数触发整段 compaction） | 同上 | 主动，会话维度 | 改 chat_history |
| 累计 token 预算硬截停 | `agenticx/runtime/token_budget.py` | 被动 | 直接停 LLM |
| Overflow Recovery L1（截断超大 tool_result） | `agenticx/core/overflow_recovery.py` | 被动，已超 budget 才触发 | 改 event_log |
| Overflow Recovery L2/L3（compaction / 启发式压缩） | 同上 | 被动兜底 | 同上 |
| `[user-goal-anchor]` 每轮重注 | `agenticx/runtime/agent_runtime.py:_build_user_goal_anchor` | 主动，每轮 | anchor 强度按场景分档，bulk 类任务不一定触发完整模式 |
| Loop Detector | `agenticx/runtime/loop_detector.py` | 主动，但作用于"已迷路"后 | 反馈到 prompt |
| Streaming tool args truncation 检测 | `agenticx/runtime/agent_runtime.py:_streamed_tool_call_truncated` | 主动 | 丢弃空参工具调用 |
| Meta prompt 「任务主线自检」 | `agenticx/runtime/prompts/meta_agent.py` | prompt 层补丁 | — |

**真实缺口**（修订后）：

1. 已有 `micro_compact_tool_result`，但它**只看单个 result 大小**，不看「同一会话连续 N 轮的同类工具是否在重复回流大文本」（典型如 mattpocock case 第 14/15/16 轮连续三次 `file_read` / `bash_exec` 把同一 SKILL.md 拉回 history）。
2. `micro_compact` 直接改 `messages.json` 持久化层 → UI 上用户看到的也是被压缩的文本，**事后无法审计原始 tool result**。
3. **没有任何机制让大 payload 一开始就不进 LLM context**——所有压缩都是"先进来再压"，对应 plan M2 要补的 reference 化传参旁路。
4. **没有任何 batch 原子操作**——bulk 类任务必然被拆成 N 轮，对应 plan M3。
5. anchor 重注与 tool_result 累计 tokens **完全解耦**——膨胀到再厉害也不会强化 anchor，对应 plan M4。

具体到 skill bulk install 场景，更是被两条产品决策叠加放大：

1. `skill_manage` 工具一次只能 create 一个 skill，且 `content` 必须是 SKILL.md **全文**（见 `agenticx/cli/agent_tools.py:628-670`）。
2. `meta_agent.py` 的 SOP 强制要求「`bash_exec` 下载 → `file_read` 读全文 → `skill_manage(content=全文)`」，意味着每个 skill 的 SKILL.md 都要进 LLM context 一次（见 `agenticx/runtime/prompts/meta_agent.py:693-702`）。

N 个 skill = N 倍 SKILL.md 全文进 history = 注意力被稀释到几乎归零。

## 目标（Goals）

- **G1**：在 tool loop 主路径上引入**主动**的 tool result 预算治理，不依赖 overflow 触发。
- **G2**：消除"大 payload 经 LLM context 中转"这个反模式：接受大文本/二进制的工具支持 reference 化传参（path / url / handle），全文不入 chat_history。
- **G3**：识别"N 个同构 tool call"模式并提供 batch 原子操作，把 N 轮压成 1 轮。
- **G4**：在 tool result 累计 token 越过阈值时，**前置**重注 user-goal-anchor（不等到 overflow）。
- **G5**：让上下文膨胀过程**可观测**，事后能定量复盘是否真的稀释。
- **G6**：以 `mattpocock/skills` 全量 bulk install 作为首个端到端验证场景，AC 直接对标该 case。

## 非目标（Non-Goals）

- 不重写 `overflow_recovery` 的 L2/L3 兜底逻辑；它们继续作为最后一道防线。
- 不动 `loop_detector` 现有规则。
- 不动 `SAFE_COMMANDS` 白名单（`curl/jq` 不会因本 plan 被加入）。
- 不引入新的 LLM 调用做主动压缩（避免又一层成本与延迟）；本 plan 的"压缩"只用规则化的截断 + 引用替换。
- 不动 token_budget 的硬截停语义（与 `2026-05-24-token-budget-exceeded-ux` plan 解耦）。
- 不重构 `skill_manage` 的核心 guard / changelog / fuzzy_patch 流程。
- 不做"把 SKILL.md 内容上传到云端再 reference"的方案——所有 reference 仅指向本机或可达 URL。

## 技术方案

整体分四层机制 M1–M5，按依赖顺序组织。P0 = 首个 commit 必须落地的最小集；P1 = 后续 commit 增强；P2 = 视效果决定。

### M1：Tool Result 预算分级（P0，与现有 micro_compact 协同）

**与现有机制的关系**：`compactor.micro_compact_tool_result` 已经做了「单个 result > 4000 chars 压 head/tail」，但它有两个限制——只看单 result 大小、且压缩结果直接覆盖 `messages.json`。M1 在它之上叠加两个维度，并把"原文审计"问题一并解决：

- **维度 A：轮次衰减**。同一会话中 `large` 类 tool result，**当前轮 + 上一轮保留 micro_compact 后的形态**；再往前的轮次降级为更短的「reference 摘要」（仅保留 tool_name + path/url + tokens + 落盘 archive 路径），不再保留 head/tail。
- **维度 B：原文审计落盘**。无论 micro_compact 还是 M1 降级，**原始 tool result 永远落盘到** `~/.agenticx/sessions/<sid>/tool_archives/<round>-<tool>-<call_id>.txt`，事后可读。

为每个工具声明一个 `result_class`，runtime 在拼装下一轮 messages 时按 class 决定保留策略：

- `small`：tool result 一般 < 500 tokens（`scratchpad_read`、`memory_search` 命中、`skill_list` 名称列表等）→ 完整保留。
- `medium`：500–4000 tokens（`code_search`、`mcp_call` 常规返回）→ 完整保留，但参与 M4 累计统计。
- `large`：4000+ tokens（`file_read` 大文件、`bash_exec` 大 stdout、`liteparse` 解析结果）→ 第一次仍走 micro_compact；**保留 ≥ N 轮后**进一步降级为 reference 摘要：

  ```
  [tool-result-archived] tool=file_read round_first_seen=14
  original_chars=12453, archived at ~/.agenticx/sessions/<sid>/tool_archives/r14-file_read-call_xxx.txt
  one_line_summary: SKILL.md for engineering/improve-codebase-architecture (frontmatter + 5 sections)
  ```

- `blob`：明确不应进 LLM context 的（如 `screencapture`、二进制下载）→ 永远只回传 path/handle，不进 history。

实现：
- `agenticx/cli/agent_tools.py` 在工具元数据里增加 `result_class` 字段（与现有 schema 平行）。
- 新增 `agenticx/runtime/tool_result_budget.py`，在 `agent_runtime` 每轮 LLM 请求前调用，对 `large` 类按维度 A 降级；改造 `compactor.micro_compact_tool_result` 让它在写入前**先**把原文落盘到 archive 目录。
- N 默认值：`AGX_TOOL_RESULT_KEEP_ROUNDS=2`。
- **持久化策略调整**（与第一稿不同）：`messages.json` 仍存压缩后的形态（与现状一致，避免 UI 大改），但**新增** `tool_archives/` 作为原文唯一审计源；Desktop 在 `ToolCallCard` 上增加「查看原始结果」按钮指向 archive 文件（P1，不阻塞 P0）。

### M2：内容传参旁路（content-by-reference）（P0）

针对接受大文本的工具，新增 reference 化参数：

- `skill_manage(action='create')`：增加 `from_path`、`from_url` 两个互斥可选参数；任一存在则忽略 `content`，由后端读取并仍走 `scan_skill` / `should_allow` guard。
  - `from_path`：只接受 workspace 内或 `~/.agenticx/` 下的绝对路径，复用 `_resolve_workspace_path` 校验。
  - `from_url`：限 `https://`，且 host 在白名单（`raw.githubusercontent.com`、`registry.clawhub.ai`、`gist.githubusercontent.com` 等，可由 `~/.agenticx/config.yaml` 的 `skill_manage.url_allowlist` 扩展）；下载尺寸上限 1 MiB，超限拒绝。
- `file_write`：增加 `from_path`（本机文件复制）。**不**增加 `from_url`，避免 file_write 变成下载器。
- 不动 `file_edit`（编辑必须看到 old/new 全文，无法 reference 化）。

向后兼容：`content` 参数保留，原有调用方零影响。

`meta_agent.py` 的 SOP 同步分两条：
- **单包安装**：仍走 `bash_exec` → `file_read` → `skill_manage(content=...)`（小内容）。
- **bulk / 大内容**：明确指引走 `skill_manage(from_url=...)` 或先 `bash_exec` 落地再 `from_path`，**禁止**把 SKILL.md 全文塞进 `content` 经 LLM context 中转。

### M3：Bulk 原子操作（P0）

新增 `skill_import_repo` 工具：

```
skill_import_repo(
  repo: str,                    # "owner/name"，必填
  branch: str = "main",
  path_glob: str = "skills/**/SKILL.md",  # 用于过滤仓库内 skill 路径
  exclude: list[str] = ["**/deprecated/**", "**/in-progress/**"],
  dry_run: bool = False,        # 只回传"将要安装的清单"，不落地
  overwrite: bool = False,      # 同名是否覆盖；默认 False（已存在则 skip）
)
```

行为：
1. 调用 GitHub API 列树，按 glob/exclude 过滤出候选 SKILL.md 列表。
2. `dry_run=True`：仅回传 `{installed: [], pending: [...], skipped_existing: [...]}`，**单条 tool result ≤ 2000 tokens**。
3. 非 dry_run：在后端依次下载、写入 `~/.agenticx/skills/<path>/SKILL.md`、走 `scan_skill` + `should_allow`、写 `.changelog`，**全程不经 LLM**；最终回传聚合摘要：

```json
{
  "installed": ["engineering/tdd", "engineering/git-worktree", ...],
  "skipped_existing": [...],
  "rejected_by_guard": [{"name": "...", "reason": "..."}],
  "errors": [...]
}
```

风控：
- 受 `AGX_SKILL_MANAGE` 同一开关约束（沿用现有「需 Run Everything 或显式启用」语义）。
- 单次调用最多安装 50 个 skill（防误操作）；超限要求分批。
- 同 M2 的 url 白名单扩展，repo host 默认仅 `github.com`。
- guard 命中"危险"等级直接拒，"caution"等级在结果中标注但仍写入（与 ClawHub install 现状一致）。

### M4：注意力锚点强化（P1）

现状：`_build_user_goal_anchor` 在 first round / complex / middle 三档分别注入不同强度的 anchor，触发条件主要看 `is_complex`（轮次/工具数量阈值）。

增强：
- 增加触发维度 `tool_result_tokens_accumulated`：当本会话累计 tool_result tokens 越过 `AGX_ANCHOR_RESTRENGTHEN_THRESHOLD`（默认 12000）时，下一轮强制使用 `complex` 模式 anchor，且把 anchor **前置**到 system prompt 末尾、user 消息之前（当前是放在 user 消息之后的额外 system 块）。
- 该阈值与 M1 的 `result_class=large` 降级阈值解耦：M1 降的是历史，M4 加的是当下提醒，两者互补。

### M5：可观测（P1）

- runtime 在每轮 `LLM_REQUEST` 事件附加 `context_stats`：`{prompt_tokens, tool_result_tokens_round, tool_result_tokens_session, anchor_mode, archived_tool_calls}`。
- SSE 推这个块；Desktop 在工具调用卡片上方显示一行 `context: 18.4k tokens · 12 tool calls · 3 archived`，方便用户感知"正在膨胀"。
- 落盘到 `~/.agenticx/sessions/<sid>/context_stats.jsonl`，便于跑 baseline 对比脚本。
- Desktop UI 改动量限制在「在现有状态条加一个 chip」级别，不做新面板。

### 配置项汇总（写入 `~/.agenticx/config.yaml`）

```yaml
runtime:
  tool_result_budget:
    enabled: true                    # M1 总开关
    keep_rounds: 2                   # M1 large 类保留轮数
    large_threshold_tokens: 4000     # M1 large 阈值
    archive_dir: ~/.agenticx/sessions/{sid}/tool_archives
  anchor_restrengthen_threshold: 12000  # M4
skill_manage:
  url_allowlist:                     # M2
    - raw.githubusercontent.com
    - gist.githubusercontent.com
    - registry.clawhub.ai
  max_url_payload_bytes: 1048576
skill_import_repo:                   # M3
  max_per_call: 50
  default_exclude:
    - "**/deprecated/**"
    - "**/in-progress/**"
```

## 实施步骤（建议提交粒度）

按可验收提交（每段都能独立 typecheck / smoke 通过）：

1. **commit 1（baseline 基线）** ✅ 已完成：
   - 新增 `scripts/measure_tool_loop_context.py`（stdlib-only，approx tokens via len/4）。
   - 用 mattpocock 安装会话 `87d99920-b68a-45b3-a77a-0f2a18cc8607` 跑出 `docs/perf/tool-loop-baseline-2026-05-24-mattpocock.md`，作为 P0 各 commit 的对照基线。

2. **commit 2（M1：tool result 预算分级）**：
   - 工具 schema 增加 `result_class` 字段。
   - `apply_tool_result_budget` 实现 + 单测。
   - tool_archives 落盘。
   - 不改 prompt，不改前端；UI 仍显示完整原文。

3. **commit 3（M2：content-by-reference）**：
   - `skill_manage` 增加 `from_path` / `from_url`。
   - `file_write` 增加 `from_path`。
   - guard / scan 路径不变。
   - meta prompt SOP 分单包/bulk 两条。

4. **commit 4（M3：skill_import_repo）**：
   - 新工具实现 + 单测。
   - meta prompt 新增「bulk 安装请优先用 skill_import_repo」指引。
   - 用 mattpocock/skills 跑端到端验证，输出对比报告。

5. **commit 5（M4 + M5：anchor 强化 + 可观测）（P1）**：
   - 触发条件扩展 + 前置注入。
   - context_stats SSE 与 Desktop chip。
   - 二次跑 baseline 脚本，验证 G6 数据。

每次 commit 都按 `/commit --spec=.cursor/plans/2026-05-24-tool-loop-context-budget.plan.md` 自动注入 `Plan-Id` / `Plan-File` trailer。

## 验收标准（Acceptance Criteria）

- **AC-1（M1 行为正确）**：模拟一次会话，连续 5 个 `file_read` 返回 20k chars 的 tool result；第 3 轮起，第 1、2 轮的 tool_result 在 chat_history 中替换为 `[tool-result-archived]` 摘要块，落盘原文可读。
- **AC-2（M1 原文可审计）**：同上场景，原文一律落盘到 `~/.agenticx/sessions/<sid>/tool_archives/`，文件名含 round + tool_name + call_id，可由 `cat` 直接读回原始内容；`messages.json` 与现状一致仍存压缩形态，不强求恢复原文。
- **AC-3（M2 from_url 安全）**：调用 `skill_manage(from_url='https://evil.example.com/x.md')` 必须被 url_allowlist 拒；调用 `from_url=` raw.githubusercontent.com 上 1.5 MiB 文件必须因超限被拒。
- **AC-4（M2 guard 等价）**：用 `from_path` 提交一个命中 guard `dangerous` 等级的 SKILL.md，必须与传 `content` 等价被拒，错误码一致。
- **AC-5（M3 端到端）**：单次 `skill_import_repo(repo='mattpocock/skills', dry_run=True)` 返回的 pending 清单 ≤ 2000 tokens；非 dry_run 一次安装完成，**全程 ≤ 3 轮工具调用**（含 1 轮 dry_run + 1 轮 install + 1 轮 skill_list 验证），且 tool_result 累计 ≤ 8000 tokens。
- **AC-6（G6 主目标）**：基线 = **30 轮 / 7,249 累计 tool_result tokens（micro_compact 后）/ 3 次 walltime_stop / 仅 3 个 skill 装入**（见 `docs/perf/tool-loop-baseline-2026-05-24-mattpocock.md`）；新方案下同任务在 **≤ 5 轮**内完成，**0 次** walltime_stop，全部 ~20 个 skill 装入，且 user-goal-anchor 在最末轮仍以 `complex` 模式存在。
- **AC-7（M4）**：单测验证当 `tool_result_tokens_session` 跨过 12000 阈值后，下一轮 anchor mode = `complex` 且位置在 system prompt 末尾。
- **AC-8（M5）**：跑一次会话后，`context_stats.jsonl` 每轮一条，字段完整；Desktop 状态条 chip 出现并随轮次刷新。
- **AC-9（向后兼容）**：现有所有 `skill_manage(content=...)` 调用零修改通过；`tests/test_smoke_hermes_agent_skill_manage.py` 全绿。
- **AC-10（不破坏 overflow recovery）**：跑一次「故意撑爆」用例，L1/L2/L3 仍按现有顺序触发；M1 降级和 L1 截断不重复作用于同一 result（M1 已 archive 的内容不再被 L1 截）。

## 风险与回退

- **风险 R1**：`large` 类降级可能误降"模型其实下一轮还要看"的关键 result。**缓解**：保留首尾 preview；archive_dir 路径出现在降级文本里，模型可主动 `file_read` 找回；首版 `keep_rounds=2` 偏保守。
- **风险 R2**：`from_url` 引入新的网络下载路径，安全面变大。**缓解**：白名单 + 尺寸上限 + 仍走 guard；默认 host 列表仅含已用过的 GitHub raw 与 ClawHub。
- **风险 R3**：`skill_import_repo` 一次写 50 个文件，部分失败时一致性。**缓解**：每个 skill 独立事务（单目录 mkdir + 写 + scan，失败 rmtree 回滚），最终聚合摘要里逐条标注成功/失败原因；不做"全失败"原子语义。
- **风险 R4**：M4 anchor 前置可能改变模型行为引入回归。**缓解**：放 P1 单独 commit，先观察 P0 三段效果；可由配置开关回退到旧位置。
- **风险 R5**：M1 的 `result_class` 标注一旦覆盖不全，效果打折。**缓解**：未标注工具默认按 `medium` 处理（保留），不会"误降"；通过 baseline 脚本统计哪些工具频繁产生 4000+ tokens，针对性补 `large` 标注。

## 与其他 plan 的关系

- 与 `.cursor/plans/2026-05-24-token-budget-exceeded-ux.plan.md`：互补。本 plan 降低撞墙概率，那个 plan 在真撞墙时给出可恢复出口。
- 与 `.cursor/plans/2026-05-20-multi-brain-knowledge-architecture.plan.md`：无直接耦合；M3 的 `skill_import_repo` 与 brain_create 风格一致（都走 `_manage` 模式 + guard）。

## 参考代码位置

- `agenticx/cli/agent_tools.py`：`SAFE_COMMANDS`、`MAX_READ_CHARS`、`skill_manage` schema、`_tool_skill_manage`、`_resolve_workspace_path`
- `agenticx/runtime/agent_runtime.py`：`_build_user_goal_anchor`、`_streamed_tool_call_truncated`、chat_history 拼装路径
- `agenticx/runtime/prompts/meta_agent.py`：skill_manage SOP、任务主线自检
- `agenticx/core/overflow_recovery.py`：L1/L2/L3 兜底压缩
- `agenticx/runtime/token_budget.py`：累计 token 预算硬截停
- `agenticx/skills/guard.py`：`scan_skill` / `should_allow`
- `agenticx/extensions/registry_hub.py`：现有 ClawHub install 流程（M3 可参考）
