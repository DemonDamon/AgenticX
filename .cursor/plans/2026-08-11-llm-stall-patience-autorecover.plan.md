# 模型超时「缓冲等待 + 自动恢复」（Cursor 式耐心模式）

Planned-with: kimi-k3
Suggested-Impl-Model: gpt-5.6-sol-medium（跨栈收口：runtime 生成器 + Electron IPC + React 组件，属跨栈中风险，强推理档合适）
Status: implementing
Plan-Id: 2026-08-11-llm-stall-patience-autorecover

## 背景与根因（证据链）

会话 `a30ef9e8`（2026-08-11 17:2x，重启后端后）：建群成功后下一轮模型调用 >180s 无响应，前端落出「模型调用失败：请检查网络与模型配置后重试。(>180s, provider=custom_openai_1782269503107, model=glm-5.2)。可点『恢复执行』重试」卡片，整轮死亡。该会话上下文已 ~119k tokens，大 prompt + 自定义代理端点首 token 缓慢是主因。

现有链路（`agenticx/runtime/agent_runtime.py`）：

1. 轮超时阈值 `DEFAULT_LLM_ROUND_TIMEOUT_SECONDS = 180.0`（426-428 行），即时重试仅 `LLM_ROUND_TIMEOUT_RETRY_LIMIT = 1` 次（4070-4087 行发「正在重试(1/2)」后 `continue`）。
2. 重试耗尽后（4088-4115 行）发 STALL + ERROR 事件并 `return`——**整轮直接死亡**，只能等用户手动点「恢复执行」。
3. 已有零件：流式首字节等待提示（`first_feedback_seconds` + `_STREAM_WAITING_HINT` → TOOL_PROGRESS `waiting_for_model`，3518-3531 行）；`except asyncio.TimeoutError` 主路径在 4026 行（另两处 4578/5281 为其它路径，本计划不动）。
4. 前端已有 `silentSeconds` 静默分级、「恢复执行」按钮、`stall_auto_nudge`（默认关）；`desktop/src/components/ChatPane.tsx:8913` 处理 `tool_progress`；`window.agenticxDesktop.loadRuntimeConfig()`（`desktop/electron/main.ts:8824` 区域 pick 键、8913 默认值、8963 保存合并）是 runtime 配置通道；设置 GUI 落在 `desktop/src/components/automation/StallNudgeConfigSection.tsx`（由 `SettingsPanel.tsx:2267-2569` 加载/保存）。

缺口：超时后 1 次重试即弃疗、等待期无可感知的动画提示、恢复需手动——没有 Cursor 式「提示可能要等更久 → 缓冲动画 → 网络恢复自动续跑」闭环。

## 目标

- FR-1（后端耐心模式）：主路径轮超时在即时重试耗尽后，进入可配置的耐心重试循环：指数退避 sleep → 重试本轮；每次尝试发 `tool_progress`（`phase="stall_patient_wait"`，含 attempt/max_attempts/waited/next_retry_in/provider/model）；总尝试数或总耗时超预算才走现有 STALL+ERROR 死亡路径（保持不变）。
- FR-2（恢复信号）：耐心等待后模型调用成功时，发 `tool_progress`（`phase="stall_patient_recovered"`）一次，供前端收起等待提示。
- FR-3（前端动画 chip）：收到 `stall_patient_wait` 时展示「网络较慢，可能要等待更长时间」动画 chip（三点缓冲动效 + 第 n/N 次重试 + 本地倒计时）；收到 token/tool_call/final/error/恢复事件时自动消失。Pro（ChatPane）与 Lite（ChatView）均接入。
- FR-4（设置开关）：Desktop 设置 Automation 区新增「模型超时自动等待恢复」开关 + 最大重试次数 + 总预算秒数，经 `loadRuntimeConfig`/`save-runtime-config` 持久化到 `~/.agenticx/config.yaml` 的 `runtime.*`。

## 非目标（Out of scope）

- 不改 4578/5281 两处 TimeoutError 路径（非本次失败路径）。
- 不改 180s 轮超时默认值与即时重试次数（LLM_ROUND_TIMEOUT_RETRY_LIMIT=1）。
- 不动「恢复执行」手动按钮与 resume 端点；不动 `stall_auto_nudge` 既有逻辑。
- 不处理 provider 级自动切换/降级（已有 `record_session_provider_hard_failure` 体系，另行规划）。
- 不动 `agenticx/studio/server.py`（高敏文件）。

## 配置项（单一事实源）

| key（config.yaml `runtime.` 下） | env 覆盖 | 默认 | 含义 |
| --- | --- | --- | --- |
| `llm_stall_patience_enabled` | `AGX_LLM_STALL_PATIENCE_ENABLED` | `true` | 耐心模式总开关 |
| `llm_stall_patience_max_attempts` | `AGX_LLM_STALL_PATIENCE_MAX_ATTEMPTS` | `3` | 即时重试耗尽后的额外耐心重试次数 |
| `llm_stall_patience_budget_seconds` | `AGX_LLM_STALL_PATIENCE_BUDGET_SECONDS` | `900` | 从首次超时起的总耗时预算（含每次 attempt 烧掉的轮超时） |
| `llm_stall_patience_base_seconds` | `AGX_LLM_STALL_PATIENCE_BASE_SECONDS` | `15` | 退避基数，单次等待 `min(base*2^(n-1), 60)` 且不超过剩余预算 |

## 实施步骤

### FR-1/FR-2 后端（`agenticx/runtime/agent_runtime.py`）

**落点 1（常量区，426-428 行附近）**：

```python
DEFAULT_LLM_STALL_PATIENCE_MAX_ATTEMPTS = 3
DEFAULT_LLM_STALL_PATIENCE_BUDGET_SECONDS = 900.0
DEFAULT_LLM_STALL_PATIENCE_BASE_SECONDS = 15.0
```

**落点 2（`_resolve_llm_invoke_timeout_seconds` 之后，约 481 行后）**新增：

```python
def _resolve_stall_patience_config(session: StudioSession) -> Dict[str, Any]:
    """Resolve patience-mode config: env first, then config.yaml runtime.*, then defaults."""
    # env > ConfigManager(runtime.llm_stall_patience_*) > 上方默认常量
    # enabled 解析："0/false/no" 视为关，其余真值；非法值回退默认。
```

**落点 3（`_bump_llm_timeout_retry_count`/`_reset_llm_timeout_retry_count` 旁，721-731 行区域）**新增会话级状态助手：

```python
def _stall_patience_state(session) -> Dict[str, float]:  # session._stall_patience = {"attempts": int, "started_at": float}
def _reset_stall_patience(session) -> None
```

**落点 4（耐心分支，4087 行 `continue` 与 4088 行 `yield STALL` 之间插入）**：

```python
                _pat = _resolve_stall_patience_config(session)
                if _pat["enabled"]:
                    _st = _stall_patience_state(session)
                    _now = asyncio.get_running_loop().time()
                    if not _st.get("started_at"):
                        _st["started_at"] = _now
                    _waited = _now - float(_st["started_at"])
                    if _st["attempts"] < _pat["max_attempts"] and _waited < _pat["budget_seconds"]:
                        _st["attempts"] += 1
                        _wait = min(
                            _pat["base_seconds"] * (2 ** (_st["attempts"] - 1)),
                            60.0,
                            max(1.0, _pat["budget_seconds"] - _waited),
                        )
                        yield RuntimeEvent(
                            type=EventType.TOOL_PROGRESS.value,
                            data={
                                "name": "模型响应",
                                "phase": "stall_patient_wait",
                                "tool_call_id": "",
                                "attempt": _st["attempts"],
                                "max_attempts": _pat["max_attempts"],
                                "waited_seconds": int(_waited),
                                "next_retry_in_seconds": int(_wait),
                                "provider": provider_hint,
                                "model": model_hint,
                            },
                            agent_id=agent_id,
                        )
                        if _st["attempts"] == 1:
                            messages.append({
                                "role": "user",
                                "content": "[系统通知] 模型响应持续超时，系统正在自动等待并重试；恢复后将继续本轮，无需用户操作。",
                            })
                        await asyncio.sleep(_wait)
                        continue
                # 耐心预算耗尽：落入既有 STALL + ERROR 死亡路径（4088-4115），不改。
```

注意：`_st["attempts"]` 与 `started_at` 挂在 `session._stall_patience`；`continue` 复用本轮循环，模型侧只追加一次 `[系统通知]`（该前缀本就不写入 chat_history）。

**落点 5（恢复事件，4250 行 `_reset_llm_timeout_retry_count(session)` 处）**：成功重置超时计数时，若 `_stall_patience_state(session)["attempts"] > 0`，先发：

```python
            yield RuntimeEvent(
                type=EventType.TOOL_PROGRESS.value,
                data={"name": "模型响应", "phase": "stall_patient_recovered", "tool_call_id": ""},
                agent_id=agent_id,
            )
```

再 `_reset_stall_patience(session)`。

### FR-3 前端

**落点 1**：新增 `desktop/src/components/messages/StallWaitChip.tsx`——受控组件：props `{ attempt, maxAttempts, nextRetryInSeconds, startedAtMs }`；本地 `setInterval` 1s 递减倒计时；三点缓冲动画（沿用现有 `loading-dots` 类或内联 keyframes，勿引新依赖）；文案「网络较慢，可能要等待更长时间 · 自动重试 {n}/{N}（{x}s 后）」。

**落点 2**：`desktop/src/components/ChatPane.tsx`
- 8913 行 `tool_progress` 分支开头：`phase === "stall_patient_wait"` → `setStallWait({...})` 后 `continue`；`phase === "stall_patient_recovered"` → `setStallWait(null)`（可短暂置 "已恢复，继续生成" 800ms 后清）后 `continue`。
- 在 `token`（8949 起）/`tool_call`/`final`/`error`/`stall` 分支清 `stallWait`。
- chip 渲染位置：状态 chips 区（`lastToolProgress` 渲染处附近），流式中 `stallWait` 非空即渲染 `<StallWaitChip .../>`。
- 新增 state 须随会话切换清理（参考既有 `setLastToolProgress(null)` 的清理点）。

**落点 3**：`desktop/src/components/ChatView.tsx:1425` 的 `tool_progress` 分支做同样两相处理 + 同样位置渲染 chip（Lite 模式）。

**落点 4**：新增 `desktop/src/utils/stall-wait-chip.ts` 纯函数（文案与倒计时格式化），配 `desktop/src/utils/stall-wait-chip.test.ts`（参照 `turn-interruption-notice.test.ts` 的既有测试框架）。

### FR-4 配置通道与设置 GUI

- `desktop/electron/main.ts`：loadRuntimeConfig 返回区（8824 附近）pick 三个新键；默认值区（8913 附近）补默认；save 合并区（8963 附近）允许三键写入。
- `desktop/src/global.d.ts`：632-669 的 `loadRuntimeConfig` / save 类型声明补三个可选键。
- `desktop/src/components/automation/StallNudgeConfigSection.tsx`：加「模型超时自动等待恢复」开关 + 两个数字输入（最大重试 1-10、总预算 60-3600 秒）；`SettingsPanel.tsx:2267-2569` 的加载/保存链路带上三键（校验：预算 ≥ 最大单轮等待）。
- 后端 `_resolve_stall_patience_config` 读 `runtime.llm_stall_patience_*`——与前端写入键名严格一致。

### FR-5 测试（`tests/test_llm_stall_patience.py`，新建）

1. `test_resolve_stall_patience_defaults` / `test_env_override` / `test_invalid_env_falls_back`。
2. `test_patience_state_bump_and_reset`（fake `SimpleNamespace` session）。
3. `test_patient_retry_recovers`（集成）：参照 `tests/test_agent_loop.py` 的 harness（`agenticx.cli.agent_loop.run_agent_loop` + fake LLM），fake LLM 的 `stream` 前 2 次 `time.sleep` 超过 invoke 超时、第 3 次正常 yield；`monkeypatch` 设 `AGX_LLM_INVOKE_TIMEOUT_SECONDS=0.2`、`AGX_LLM_ROUND_TIMEOUT_SECONDS=0.3`、`AGX_LLM_STALL_PATIENCE_BASE_SECONDS=0.05`、attempts=3；断言最终返回正文且 llm 调用数 = 3。若该 harness 不支持事件捕获，则以「最终成功返回 + 调用次数」为断言，事件序列改手工验证写入 AC。
4. `test_patience_disabled_keeps_old_death`：关开关后同样场景在即时重试耗尽后不再继续（llm 调用数 = 2）。
5. 回归：`tests/test_agent_loop.py` 当前有 4 条 main 上既红（与本次无关，已在 loop-halt 修复时验证），不得新增红色；`tests/test_loop_halt_progress.py`、`tests/test_meta_group_tools.py` 保持绿。
6. 前端：`desktop/src/utils/stall-wait-chip.test.ts` 全绿；`desktop` 下 `npx tsc --noEmit` 不得新增错误（既有 voice/ChatPane 3 条旧错为基线）。

## Requirements

- FR-1: 耐心循环开关/次数/预算/退避可配，SSE 载荷含 attempt/max_attempts/waited/next_retry_in/provider/model。
- FR-2: 恢复时恰好发一次 `stall_patient_recovered` 并重置状态。
- FR-3: chip 动画 + 倒计时 + 自动消失；ChatPane 与 ChatView 均生效；会话切换不残留。
- FR-4: 设置 GUI 三键持久化并与后端读取一致。
- NFR-1: 无新依赖；耐心模式默认开启但可由 config/env 关闭；关闭后行为与现状逐字节一致。
- NFR-2: 不触碰 `studio/server.py`；不改既有 STALL/ERROR 死亡文案。
- AC-1: 后端 5 条测试通过；既有红不新增。
- AC-2: 手工验证（描述即可）：glm-5.2 慢代理下发起对话 → 180s 后出现动画 chip 与倒计时 → 代理恢复后自动续跑，无需点「恢复执行」。
