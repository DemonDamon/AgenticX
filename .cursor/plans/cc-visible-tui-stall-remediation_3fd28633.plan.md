---
name: cc-visible-tui-stall-remediation
overview: 定位本次对话中 cc-bridge visible_tui 卡住与误导行为的根因，并给出分层修复方案（策略层、运行时层、工具层）。
todos:
  - id: prompt-constraint-visible-tui
    content: 在Meta系统提示中加入visible_tui返回后的强制停机与回报规则
    status: completed
  - id: guard-block-log-tail
    content: 为visible_tui活跃会话增加bash日志轮询拦截护栏
    status: completed
  - id: auto-mode-selection
    content: 按任务意图自动选择headless/visible_tui并允许显式覆盖
    status: completed
  - id: result-evidence-gate
    content: 增加无证据不总结的结果门禁与失败文案
    status: completed
  - id: status-event-normalization
    content: 统一cc-bridge状态事件，降低模型误判等待
    status: completed
isProject: false
---

# cc-bridge visible_tui 卡住问题诊断与修复计划

## 问题结论
- 对话中存在明显问题，且是“策略与执行链路不一致”导致的复合故障，不是单一 bug。
- 主要表现：`cc_bridge_send` 在 `visible_tui` 已返回“已发送到终端交互”后，Meta 仍继续轮询日志、调用无关工具，最终中断 session 并输出未经验证的结论。

## 证据与定位
- `cc_bridge_send` 在 `visible_tui` 分支是**立即返回 sent**，不等待结果：`agenticx/cli/agent_tools.py`（`_tool_cc_bridge_send`）。
- `cc_bridge` 实际 API 也是 `/v1/sessions/*`，并不存在对话中提到的 `/session/start`、`/prompt`：`agenticx/cc_bridge/http_app.py`。
- 说明“等待 CC 完成并自动回传完整报告”与当前 `visible_tui` 机制本身不匹配（该模式本质是人工交互终端）。

## 根因分解
- **根因1（策略层）**：Meta 在收到 `interactive=true` 后缺少强约束终止条件，继续“自动追踪结果”。
- **根因2（运行时层）**：未对 `visible_tui` 场景做工具调用护栏，允许 `bash_exec tail cc-bridge.log` 这类低价值噪声轮询。
- **根因3（模式选择层）**：任务目标是“自动产出结构化分析”，却使用了 `visible_tui`；该模式要求人工参与，不适合无人值守。
- **根因4（结果可靠性层）**：未建立“无证据禁止总结”门槛，导致中断后仍给出可能失真的架构结论。

## 修复方案（按优先级）
1. **P0：加硬性行为约束（必须）**
   - 在 Meta 系统提示中加入规则：当 `cc_bridge_send` 返回 `mode=visible_tui && interactive=true` 时，禁止继续调用 `bash_exec/cc_bridge_send/cc_bridge_stop` 进行“结果追踪”，必须向用户回报“已投递，等待用户在终端交互”。
   - 目标文件：`agenticx/runtime/prompts/meta_agent.py`。
2. **P0：工具级护栏（必须）**
   - 在 `bash_exec` 前置 guard 中增加规则：若当前会话存在活跃 `visible_tui` session，拒绝 `tail ~/.agenticx/logs/cc-bridge/*.log` 轮询命令，并返回高信号提示。
   - 目标文件：`agenticx/hooks/bundled/pre_tool_guard/handler.py`（或等价 guard 链路）。
3. **P1：模式自动选择（强烈建议）**
   - 对“请求自动产出最终报告”的任务，默认走 `headless`；仅当用户明确要“可见终端人工接管”时使用 `visible_tui`。
   - 目标文件：`agenticx/cli/agent_tools.py`（`_tool_cc_bridge_start` / 调度策略）。
4. **P1：结果门禁（强烈建议）**
   - 若未收到可验证结果（例如 `final` 或明确输出块），禁止生成“完成结论”；改为“执行未完成+当前状态+下一步操作”。
   - 目标文件：`agenticx/cli/agent_tools.py` + `agenticx/studio/server.py` 事件消费路径。
5. **P2：状态回传优化（建议）**
   - 将 `visible_tui` 的状态统一为可读事件（启动/等待人工/结束），减少模型靠猜测做“继续等待”决策。
   - 目标文件：`agenticx/cc_bridge/session_manager.py`、`agenticx/studio/server.py`。

## 验收标准
- 在 `visible_tui` 下，`cc_bridge_send` 返回后 Meta 不再进入日志轮询循环。
- 无用户交互时，不会自动 `cc_bridge_stop` 并给出“已完成”结论。
- 自动分析类任务默认走 `headless` 并可直接回传结构化结果。
- 对不存在的 API 或未验证路径不再输出为“事实结论”。