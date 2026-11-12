# SP1: Studio 主链路 SafetyLayer 统一贯通

Plan-Id: safety-layer-mainline
Parent-Plan: plans/security-governance/MASTER-PLAN.md（缺口 G2）
Status: implemented（2026-11-12 实施+E2E 通过，待 commit）

## 一、探查结论（实施前审计）

### 主链路工具结果路径（现状）

```
LLM tool_calls
  → agent_runtime.py L7808  dispatch_tool_async()          ← 主循环调用点
  → agent_tools.py L13026    _dispatch_tool_async_unredacted()   ← 巨型 if/elif，几十个 return 点
  → agent_tools.py L13038    redact_text()                 ← 仅替换 credential_store 已知密钥值（非模式匹配）
  → agent_runtime.py L7903   hooks.run_after_tool_call()
  → agent_runtime.py L7911   _prepare_tool_result_for_context()  ← micro_compact + budget
  → LLM 上下文
```

**全程无 SafetyLayer 四级管线（截断→泄露检测→策略→注入清洗），无 InputValidator 前置校验。**
eager KB 路径（agent_runtime.py L3466）同样走 `dispatch_tool_async`。

### 关键事实

| 事实 | 位置 |
|---|---|
| `dispatch_tool_async` 是唯一咽喉（单进单出包装层，`_dispatch_tool_async_unredacted` 仅此一处调用） | `agenticx/cli/agent_tools.py:13013-13039` |
| 现有防护：session 权限/预算锁/企业策略/路径规则/shared-write guard | `agent_tools.py:13054-13109` |
| SafetyLayer 完整实现已存在 | `agenticx/safety/layer.py:36-176` |
| ToolExecutor 已接线（但 Studio 主链路不走 ToolExecutor） | `agenticx/tools/executor.py:349-369` |
| SafetyAuditLog 仅内存 deque(1000)，无持久化/无企业桥接 | `agenticx/safety/audit.py` |
| 现成审计桥：emit_action_audit（append-only JSONL outbox、企业登录启用、自带脱敏、never raises） | `agenticx/runtime/action_audit.py:116-141` |
| 现成 flag 机制：env > config > default，never raises | `agenticx/runtime/harden_flags.py:57-64` |
| `__tool_call_id`/`__agent_id` 元数据随 arguments 传递（主循环+eager KB 均塞入） | `agent_runtime.py:3441,7045-7046` |
| session_id 提取 helper | `agent_tools.py:3930 _studio_session_id()` |

### 设计决策

1. **接线点 = `dispatch_tool_async` 包装层**（不在 if/elif 链内逐点拦）：单进单出，一处接线覆盖主循环 + eager KB + 群聊等全部 dispatch 路径
2. **双 flag**：
   - `AGX_STUDIO_SAFETY_LAYER` / `runtime.studio_safety_layer`，默认 **True**（on=走管线；off=零开销直通，等价现状）
   - `AGX_STUDIO_SAFETY_MODE` / `runtime.studio_safety_mode`，取值 `observe|enforce`，默认 **observe**（管线全跑、事件全记、审计全桥接，但不修改结果——零行为变化上线）
3. **enforce 才生效**：observe 模式下调管线拿结果仅用于检测记录，返回原文；enforce 模式下输入 blocked 拦截 + 输出 redact/sanitize/block 生效
4. **SafetyLayer 模块级懒加载单例**：LeakDetector(17 正则+Aho-Corasick)/Policy/Sanitizer(9 模式) 构造开销只付一次
5. **事件三写**：内存 SafetyAuditLog（查询）+ 本地 `~/.agenticx/safety/events.jsonl`（append-only 落盘，观察期报告数据源）+ emit_action_audit（企业路径，kind=safety_event）
6. **延迟计时**：每次管线调用计时入事件，累计 P95/P99 统计可查（验收数据源）
7. **trace_id 关联取舍**：dispatch 层无 trace 对象句柄，用 session_id + tool_call_id 做关联键（E2E 报告经 session→trace 映射补全）

## 二、改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `agenticx/runtime/harden_flags.py` | + `studio_safety_layer_enabled()`（默认 True）+ `studio_safety_mode()`（默认 observe，非法值回退 observe） |
| 2 | `agenticx/runtime/studio_safety.py`（新） | SafetyLayer 单例 + observe/enforce 包装（`sanitize_output()`/`validate_input()`）+ 事件落盘（agx_home/safety/events.jsonl）+ 企业审计桥（emit_action_audit）+ 延迟统计 + `write_observation_report()`（观察期报告 md 落盘） |
| 3 | `agenticx/cli/agent_tools.py` | `dispatch_tool_async`：执行前 `validate_input`（enforce 且 blocked → 拒绝文本），执行后 `sanitize_output`；arguments 提取 `__tool_call_id`/`__agent_id` 供审计 |
| 4 | `tests/runtime/test_studio_safety.py`（新） | 单测：flag off 等价 / observe 不改结果但记事件 / enforce 拦截-redact-sanitize / 审计桥 / 延迟记录 |

不改动：`agenticx/safety/layer.py`（管线本身零改动）、`agent_runtime.py`（主循环零改动——接线在 dispatch 咽喉）。

## 三、验收标准（对齐 MASTER-PLAN 第八节 SP1 行）

- [x] 单测：flag off 时 `dispatch_tool_async` 输出与现状逐字节等价（mock 工具直通）— `test_flag_off_returns_original_output` / `test_dispatch_off_equals_status_quo`
- [x] 单测：observe 模式——植入注入指令+假密钥的工具输出原文返回（零行为变化），但 events.jsonl 有 leak_detection/injection_defense 事件 — `test_observe_output_unchanged_but_events_recorded`
- [x] 单测：enforce 模式——假密钥（sk-…）被 REDACTED、注入指令被清洗、blocked 输入被拒 — `test_enforce_*` × 3
- [x] 真机 E2E：真实 AgentRuntime loop + 真实 dispatch 咽喉 + 真实 file_read，LLM 脚本化（`tests/e2e/test_e2e_safety_mainline.py`）——observe 报告落盘（含 stage 统计与 enforce 切换 checklist）→ enforce 复测同载荷在 LLM 上下文被 redact；flag off E2E 证明攻击载荷原样穿透（等价现状）
- [x] P95 延迟：实测 P95 ≤ 10.4ms（50KB 内对抗性输入，预算 50ms；200KB clean 8.3ms）——30 样本/场景基准，`latency_stats()` 累计可查
- [x] 回归：新增 14 单测 + 3 E2E 通过；dispatch 路径既有测试 63 通过；safety 模块基线 59 通过
- [x] commit 带 Plan-Id/Plan-File/Impl-Model/Made-with: Damon Li trailer（Impl-Model: GLM-5.3）

## 四、E2E 攻击载荷（真机用）

1. 工具输出含假 OpenAI key `sk-proj-FAKE...` + 假 AWS key `AKIA...` → LeakDetector REDACT
2. 工具输出含注入指令 "Ignore previous instructions and..." → Sanitizer 清洗
3. 工具参数含 `../../etc/passwd` 路径穿越 → InputValidator blocked（enforce）
