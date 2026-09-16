# Meta 静态规则分层瘦身

Planned-with: grok 4.6
Suggested-Impl-Model: composer-2.5

> 实施前把本文件移到 `.cursor/plans/2026-09-05-meta-static-prompt-slim.plan.md`。只凭本文即可落地，不要依赖对话记忆。

**Goal:** 把 Meta 静态 system prompt 从约 19 444 字压到 **≤ 12 500 字**，且不改 CORE 工具清单、不新建「加载后再注入纪律」机制。

**Architecture:** 沿用已落地的 prompt diet：触发/禁令留静态（模型必须先知道该不该调），参数/事故细则进对应工具 `description`（工具被延迟时细则一起消失）。不存在、也不做 load-time prompt injection。

**Tech Stack:** Python prompt builders in `agenticx/runtime/prompts/meta_agent.py` + tool schemas in `agenticx/cli/agent_tools.py` + pytest.

---

## 对 grok 4.6 建议的裁定（实施前必读）

方向对：**静态块比 CORE 更该砍**；很多长文是给延迟工具写的说明书；本波不动 CORE。

两处必须纠正，否则会回退产品：

1. **不能把 `show_widget` / `show_images` / `query_data_source` 整节搬走。**  
   `tests/test_prompt_token_diet.py` 的 `test_show_widget_trigger_rules_stay_in_the_prompt` 已写明：细则可以延迟，「什么时候必须出图」必须留在静态块，否则模型不会去调延迟工具。仓库里 `_build_widget_capability_block` 注释也是这个分层。 grok 说「给没加载的工具上课=浪费」只对 *how-to* 成立，对 *when-to* 不成立。
2. **不要做「加载后再注入纪律」。**  
   `agenticx/runtime/tool_search.py` 的 `TOOL_AUTO_LOADED_TEMPLATE`（约 L23–26）只告诉模型下一轮重试，没有把长文塞回 prompt 的通道。新建该通道要改 `AgentRuntime` 组消息，超出本 plan，且会再污染前缀缓存。

其余成立：执行纪律是事故厨房；HITL 长文与 `request_clarification` schema 大量重复；LSP 整节可删（名字已在 `<session-context>` 延迟清单）；cc_bridge / 定时任务细则应跟工具走。

知识库节「常关所以整节是死文」**对本机不一定成立**：`_build_kb_retrieval_policy_block` 在 enabled 时会长到近千字。本 plan 只压缩 how-to，保留 mode/auto/always 策略句。

---

## In scope

- `agenticx/runtime/prompts/meta_agent.py` 各 `_build_*` 与 `build_meta_agent_system_prompt` 里内联的「执行纪律 / 调度策略 / HITL / 核心职责 / MCP 闭环」字符串
- `agenticx/runtime/prompts/skill_authoring.py` 的 `build_skill_authoring_prompt_block`（压缩，不删入口纪律）
- `agenticx/cli/agent_tools.py` 里 `cc_bridge_send`、`schedule_task`、`show_images`、`lsp_*` 的 `description` 补事故细则
- 对应测试：`tests/test_prompt_token_diet.py`、`tests/test_smoke_show_images_prompt.py`、`tests/test_smoke_data_source_skill_discipline.py`、`tests/test_context_budget.py`（若仍绑绝对字数）

## Out of scope

- `CORE_ALWAYS_LOAD_TOOLS`、ToolSearch 阈值、MCP 展平
- `agenticx/studio/server.py` 顶部 import（禁止整段替换）
- 分身/群路由/委派路径的 `build_current_time_block()`（那些路径没有 session-context 尾部）
- 新建 loaded-tool prompt 注入
- 压缩用户档案 / Computer Use 开关打开时的能力块（配置驱动，保持原样）
- Desktop UI、占用弹窗口径

---

## 分层规则（改每一段都套这一条）

| 层 | 留在哪 | 例子 |
|---|---|---|
| A 宪法 | 静态，可略压字但不删语义 | 中文、密钥、分身优先、`[/xxx]` 禁仿造、goal-anchor、少说多调、`confirm_required` |
| B 触发 | 静态，**压成短列表** | 「架构/流程必须 `show_widget`」「看照片必须 `show_images`」「可核实数字必须 `query_data_source`」 |
| C 用法/事故 | 工具 `description` | cc_bridge visible_tui 禁轮询、schedule 禁止先读 skill 大文件、show_images 禁运营位 URL |
| D 目录 | 已在 session-context | 延迟工具名清单；静态最多一句「直接调用，系统会加载」 |

---

### FR-1: 静态 prompt 字数闸门

**落点：** `tests/test_prompt_token_diet.py`，紧挨现有 `test_fixed_request_overhead_stays_under_budget`（约 L284）

```python
def test_meta_static_prompt_stays_under_char_budget():
    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session, include_volatile=False)
    assert len(prompt) <= 12_500, f"static prompt regressed to {len(prompt)} chars"
```

**AC-1：** 改造前此测试红（实测 ~19444）；改造后绿。`test_fixed_request_overhead_stays_under_budget` 仍绿（闸门 16000 先不动，除非本波后内部估价明显更低再另议）。

---

### FR-2: 触发条件仍在静态；how-to 不在静态

**落点：** 保留并收窄 `test_show_widget_trigger_rules_stay_in_the_prompt`（`tests/test_prompt_token_diet.py` L272）

改造后静态 `include_volatile=False` 的 prompt **必须**仍含：

- `强制触发` 与 `show_widget`
- `show_images` 与「禁止只用表格」（触发，不是 URL 过滤清单）
- `query_data_source` 与「编造」（`tests/test_smoke_data_source_skill_discipline.py` 测的是 helper 函数，helper 可缩短但这两个词必须在）

静态 prompt **不得**再含（搬进 tool description 或删除重复）：

- `cc_bridge 可见模式强约束`
- `write is only for visible_tui`
- `lsp_goto_definition(file, line, column)`（整份 LSP 教程）
- `URL content and visual inspection`（英文整节标题）
- `今天日期：`（已在前一 commit 去掉，勿加回）

**AC-2：** 新增 `test_static_prompt_has_triggers_not_deferred_manuals`：上面「必须有 / 不得有」各断言一遍。

---

### FR-3: 压缩/搬家的精确 before-after

只改下列函数与字符串，禁止顺手重排整个 `build_meta_agent_system_prompt`。

#### 3.1 `_build_widget_capability_block`（`meta_agent.py` 约 L755–787）

**Before：** ~1367 字，含工作流三步、思考块、强制触发、绝对禁止、技能预览图例外。  
**After：** ≤ 520 字，保留：内置 `show_widget`、直接调用可加载、强制触发四条、禁止 ASCII/箭头冒充流程、禁止出图后再用代码块重画。删掉与 description 重复的 format/CDN 细则（已有 `test_tool_usage_rules_live_in_the_description_not_the_prompt` 的 `CDN 白名单`）。思考块纪律若删，须在「输出要求」里留一句「衔接语写在可见正文，不写进思考块」。

#### 3.2 `_build_inline_photo_display_block`（约 L740–752）+ `show_images` description（`agent_tools.py` 约 L2393–2399）

**Static after：** ≤ 220 字：用户要看图必须 `show_images`；文本模型也能出图；禁止说气泡不能渲染；流程 `web_search → web_fetch → show_images`。  
**Description 追加：** 不要图集 HTML；不要 `/ops/` `/avatar/` `/banner/` 或边长 ≤160 的运营位；不要用 `generate_image` 画公众人物。  
**测试：** `tests/test_smoke_show_images_prompt.py` 对 helper 的 `/ops/` 等断言改为：helper 仍含 `show_images`/`禁止只用表格`/`无法在气泡内渲染图片`；`/ops/` `/avatar/` `generate_image` 改断言在 `STUDIO_TOOLS` 里 `show_images` 的 description。

#### 3.3 `_build_url_vision_capability_block`（约 L720–737）

**After：** ≤ 180 字中文：URL 正文用 `web_fetch`；要看图用 `view_image` / 文本模型用 `analyze_image`；不要预览每一张。删整节英文长文。

#### 3.4 `_build_lsp_context`（约 L565–580）

**After：** 不超过 4 行：代码跳转/引用/类型/诊断用 `lsp_*`（在延迟清单里），直接调用即可。禁止再列四个函数签名和使用建议小作文。`build_meta_agent_system_prompt` 约 L1121 仍调用它，不要删调用。

把「优先 lsp 不要先 grep」补进 `lsp_goto_definition` / `lsp_find_references` / `lsp_hover` / `lsp_diagnostics` 各自 description（`agent_tools.py` 约 L1942 起），每条加一句即可。

#### 3.5 `_build_data_source_discipline`（约 L789–799）

已是触发层，可再压到 ≤ 220 字，三个要点不丢：可核实数字禁编造、先 `list_data_sources` 再 `query_data_source`、数字须与工具返回一致。`test_data_source_discipline_mentions_key_tools` 必须继续绿。

#### 3.6 内联「执行纪律」（`build_meta_agent_system_prompt` 约 L1029–1063）

**After：** ≤ 1200 字。**必须留：** 禁止只说不调；拿到结果前少讲；连续 2 次失败要归因；`confirm_required` 与禁止虚构 `confirm_*`；方括号标签只读；goal-anchor 自检；文件必须真落盘、禁止 `sandbox:` 协议链接；能力类问题不要 `check_resources`。

**整段剪走，写入工具 description：**

- cc_bridge 三段（可见模式 / 证据门禁 / 模式路由）→ 追加到 `cc_bridge_send`（`agent_tools.py` 约 L1091–1096）。现有 description 只有英文协议句，必须补中文事故纪律，且含 `visible_tui`、`禁止 bash_exec 轮询`、`parsed_response 为空不得称分析完成`、`write is only for visible_tui` 只纠偏一次。
- 定时任务两段 → 追加到 `schedule_task`（约 L2009–2014）：参数齐了同一轮直接调用；不要先 `file_read` `~/.cursor/skills/*` 大文件。
- `bash_bg_*` 扫码/poll 细则 → 追加到 `bash_bg_start` description（检索 `name": "bash_bg_start"`）。静态只留一句：「扫码/阻塞命令用 `bash_bg_start`，不要用 `bash_exec`。」
- `rm -rf` / `curl|bash` → 已有 hook，静态留一句禁止合并删除与下载即可。

#### 3.7 内联「调度策略」todo 论文（约 L979–997）

**After：** ≤ 450 字。保留：文档/分析类禁止 `todo_write`；真多步执行才写；禁止秒级动作立项；完成一项立刻更新、禁止最后批量打钩。删掉大段正反例可以各留一行。

#### 3.8 内联 HITL（约 L1111–1119）

**After：** ≤ 400 字。保留：开放式决策必须 `request_clarification`、禁止正文提问后结束回合；不可逆外部写必须 `request_action_confirmation`；权限确认仍走 `confirm_required`；展示名不用内部 provider id。参数字段（`decisions` / `selection_mode` / `exclusive_options`）已在工具 schema，静态不要再抄。

#### 3.9 「你的核心职责」（约 L966–978）

**After：** ≤ 450 字。保留分身优先（`delegate_to_avatar` vs `spawn_subagent`）、`set_taskspace` 一句、问进度调一次 `query_subagent_status`。`check_resources` / `recommend_subagent_model` 各缩成一句（二者是延迟工具）。`send_bug_report_email` 与后文重复则这里删。

#### 3.10 MCP 闭环（约 L1013–1028）+ 分身协作（约 L1098–1110）

各压约 30%，语义不删：`tool_search` 优先、禁止臆造 MCP 工具名、browser-use 已连接时不要默认 Playwright；分身身份问答禁止 `delegate`、已注册分身禁止 `spawn_subagent`。

#### 3.11 `_build_kb_retrieval_policy_block`（约 L615–682）

enabled 分支：删 JSON 形如 `{ok, hits:...}` 与角标变体小作文（引用规范已在联网搜索节）。保留 mode/auto/always、禁用三行、记忆边界、「本轮没调就禁止 `[N]`」。

#### 3.12 `build_skill_authoring_prompt_block`（`skill_authoring.py` L10–25）

压到 ≤ 350 字。保留：复杂任务可存 skill；禁止 `file_write` 直写 `~/.agenticx/skills/`；细则见 `skill_manage` description。`tests/test_smoke_trinity_skill_protocol.py` 测的是 `MetaSkillInjector`，**不要改** `USING_AGENTICX_SKILL` 全文（那是另一段 ~866 字，本波不动，避免 skill-first 产品回归）。

---

### FR-4: 回归清单（实施者必须跑）

```bash
/Users/damon/.local/bin/python3.12 -m pytest --no-cov \
  tests/test_prompt_token_diet.py \
  tests/test_smoke_current_time_grounding.py \
  tests/test_smoke_show_images_prompt.py \
  tests/test_smoke_data_source_skill_discipline.py \
  tests/test_smoke_trinity_skill_protocol.py \
  tests/test_context_budget.py \
  tests/test_provider_display.py \
  -q
```

期望全绿。本机再印一次：

```python
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt
from agenticx.studio.session_manager import StudioSession
p = build_meta_agent_system_prompt(StudioSession(), include_volatile=False)
print(len(p))  # <= 12500
```

改完 `meta_agent.py` 不必冷启动 `agx serve`（未碰 `server.py` import）。Desktop 需完全退出后再发同一句 `wb_bridge_start`：气泡 ↑ 仍约 40K 量级（工具 schema 没动），静态块应从 cache_prefix 的 ~19444 降到 ≤12500。

---

## 实施顺序（TDD）

1. 先写 FR-1 / FR-2 失败测试并确认红。  
2. 按 3.1→3.12 改 helper / 内联字符串 / tool description，每改 2–3 块跑一次相关测试。  
3. 字数闸门绿后跑 FR-4 全套。  
4. 一次 commit，trailer：`Plan-Id: 2026-09-05-meta-static-prompt-slim` / `Plan-File: .cursor/plans/2026-09-05-meta-static-prompt-slim.plan.md`。

## 子规划 → 推荐模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| 全文落地 | composer-2.5 | 字符串搬迁 + 断言，无跨栈、无视觉 |
| 若实施中触发 Desktop 回归再看占用弹窗 | 不要在本 plan 修 | Out of scope |
