---
name: fix-cc-headless-send-routing
overview: 修复 CC Bridge 在全局 visible_tui 配置下仍错误将 headless 会话走 /write 的问题，并补齐路径与循环保护，确保安全审计类任务可稳定在 headless 闭环执行。
todos:
  - id: add-session-detail-endpoint
    content: 新增 /v1/sessions/{id} 并暴露权威 mode/state/cwd
    status: completed
  - id: fix-send-routing-by-session-mode
    content: cc_bridge_send 按 session_id 实际 mode 路由并加入一次性纠偏
    status: completed
  - id: improve-default-cwd-resolution
    content: cc_bridge_start 默认 cwd 优先 git 根目录
    status: completed
  - id: add-loop-guard-prompt
    content: Meta 提示层限制模式失配类错误重复重试
    status: completed
  - id: add-regression-tests
    content: 补齐 HTTP/路由/cwd 三类回归测试
    status: completed
isProject: false
---

# 修复 CC Bridge Headless 执行链路计划

## 目标
让用户在保持全局 `visible_tui` 配置时，仍可通过明确指令稳定执行 `headless` 任务，避免 `cc_bridge_send` 误走 `/write`、路径拼接错误与无进展重试循环。

## 根因与证据
- `cc_bridge_send` 先用 `cc_bridge_mode()` 判路由，若判成 `visible_tui` 就直接调用 `/v1/sessions/{id}/write`，而该接口只允许 visible 会话，因此 headless 会话报 `400 write is only for visible_tui sessions`。关键代码在 [agenticx/cli/agent_tools.py]。
- 当前“模式纠偏”依赖 `GET /v1/sessions` 列表扫描，存在失配窗口；未绑定到“当前 session_id 的权威模式”。
- 会话 `cwd` 使用 [agenticx/cli/agent_tools.py] 的 `_session_default_cwd_for_cc_bridge()`，当会话根在 `.../agenticx` 时，用户给 `agenticx/...` 相对路径容易形成 `.../agenticx/agenticx/...`。

## 变更方案

### 1) 会话模式判定改为 `session_id` 级别（P0）
- 在 [agenticx/cc_bridge/session_manager.py] 增加单会话查询方法（返回 mode/state/cwd）。
- 在 [agenticx/cc_bridge/http_app.py] 新增 `GET /v1/sessions/{session_id}`（鉴权一致）。
- 在 [agenticx/cli/agent_tools.py] 的 `_tool_cc_bridge_send()` 改为：
  - 先按 `session_id` 查询真实 mode；
  - `headless` 固定走 `/message`；`visible_tui` 固定走 `/write`；
  - 去掉对全局模式的主导依赖（仅作为最后兜底）。

### 2) 增加模式失配自动纠偏（P0）
- 在 [agenticx/cli/agent_tools.py] 中增加一次性 fallback：
  - 若走 `/write` 收到 `write is only for visible_tui sessions`，立刻改走 `/message` 重试一次并返回 `mode_corrected=true`；
  - 若走 `/message` 遇到会话不可用错误，返回高信号错误（不重复重试）。
- 目标是把“可自恢复问题”在工具层自愈，避免 Meta 连续重试同一失败动作。

### 3) 默认 cwd 选择优化（P1）
- 在 [agenticx/cli/agent_tools.py] 的 `_session_default_cwd_for_cc_bridge()`：
  - 当 `cwd` 未显式传入时，优先尝试 `workspace_dir` 对应 Git 根目录（存在 `.git`）；
  - 无 Git 根再回退原逻辑。
- 减少审计提示里使用 `agenticx/...` 相对路径时的双前缀问题。

### 4) 防循环提示与行为约束（P1）
- 在 [agenticx/runtime/prompts/meta_agent.py] 增补一条强约束：
  - 若 `cc_bridge_send` 返回模式失配类错误（如 `/write` 仅支持 visible），最多执行 1 次纠偏动作；失败则停止重试并汇报需要用户操作。
- 目的：避免你日志里出现的“同错误连发 + loop-critical”。

### 5) 回归测试（P0）
- 扩展 [tests/test_cc_bridge_http.py]：
  - 新增 `GET /v1/sessions/{id}` 成功/404 用例；
  - 覆盖 headless 会话调用 `/write` 返回 400 的断言。
- 新增 `tests/test_cc_bridge_send_mode_resolution.py`：
  - mock `cc_bridge_mode=visible_tui` + 实际 session=headless，断言 `_tool_cc_bridge_send()` 走 `/message`；
  - 覆盖 `/write` 400 后自动纠偏一次并成功。
- 新增 `tests/test_cc_bridge_cwd_resolution.py`：
  - 覆盖 `workspace_dir` 在子目录时优先落到 git root。

## 验收标准
- 在全局设置 `visible_tui` 下，执行“headless 审计”不会再触发 `/write` 400。
- `cc_bridge_send` 对同一 session 使用权威 mode，且模式失配可自动纠偏一次。
- 相同错误不会连续重试触发 loop-critical。
- 审计类提示中的 `agenticx/...` 路径不再高概率拼接成 `.../agenticx/agenticx/...`。

## 验证命令（实施后）
- `pytest tests/test_cc_bridge_http.py -q`
- `pytest tests/test_cc_bridge_send_mode_resolution.py -q`
- `pytest tests/test_cc_bridge_cwd_resolution.py -q`
- （可选）`pytest tests/test_cc_bridge_http.py::test_smoke_spawn_real_claude -q`（需本机 claude + 凭据）