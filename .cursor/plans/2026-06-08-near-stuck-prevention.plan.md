# Near 任务「卡住」系统性防治 Plan

> Plan-Id: 2026-06-08-near-stuck-prevention
> 日期：2026-06-08
> 触发案例：session `0fee98cb-fff6-47bd-8022-ad9cec8f5dcf`（infra-monitor skill 更新，静默 1500s+ 不闭环）
> 目标：让用户「绝不会觉得一个简单任务卡这么久，连 Cursor 都做完了」——把不可见的 hung/绕路/续跑失效，变成可感知、可自愈、可一键接管。

---

## 0. 背景与问题定位

案例复盘（详见 `.myblog/20260608/near-session-0fee98cb-infra-monitor-stuck-analysis.md`）暴露 **5 类系统性缺陷**，它们叠加导致「简单任务卡死」：

| # | 缺陷 | 用户可见症状 |
|---|------|--------------|
| D1 | **LLM 单轮推理 hung**（provider 长时间无 token） | UI 只显示「静默 Ns」，转圈无尽头 |
| D2 | **无人值守自检失效**（scratchpad `"1"` 字符串 ≠ `is True`） | 开了无人值守却不自动续跑 |
| D3 | **hung 时续跑无法 interrupt**（auto-continue 不打断 running） | supervisor 即使触发也被 running 态挡住 |
| D4 | **agent 绕路无收敛**（guard 拒绝 → delete/recreate/file_write 循环） | tool 轮次爆炸、进度倒退 |
| D5 | **Todo/进度与磁盘 reality 脱节** | sticky bar 卡在已完成步骤，误导「还没做完」 |

核心判断：**这不是单点 bug，而是「卡住可观测性 + 自愈闭环」缺失**。需分层治理：先止血（P0），再自愈（P1），最后体验打磨（P2）。

---

## 1. 设计原则

1. **永不无声转圈**：任何停滞 > 阈值必须有「在做什么 / 卡在哪 / 预计多久 / 怎么接管」的可见信号。
2. **超时优先于挂起**：每一层（LLM 轮次、tool、provider 连接）都要有硬超时，宁可失败重试也不无限等。
3. **自愈先于打扰**：能后台续跑/切换 fallback 的不打断用户；确实卡死再升级为可见告警。
4. **进度可信**：UI 进度必须能回落到「磁盘/真实产出」这一单一真相源。
5. **范围隔离**：本 plan 仅改 stall/续跑/可观测链路，不重构 agent_runtime 主逻辑、不动 skill guard 安全规则的判定标准（仅改善其 UX 反馈）。

---

## 2. 需求清单

### P0 — 止血（本周必须）

**FR-P0-1｜LLM 单轮推理硬超时**
- 在 `agent_runtime.py` 的每轮 LLM 调用包一层 `asyncio.wait_for`（可配 `runtime.llm_round_timeout_seconds`，默认 180s）。
- 超时后：记一条可见 tool 消息「模型 N 秒无响应，正在重试 / 切换」，触发 1 次重试；二次超时则置 `execution_state=interrupted` 并发 SSE `stall` 事件。
- AC：模拟 provider 挂起 200s，会话在 ~180s 内自动产生可见信号并进入可续跑态，不再无限转圈。

**FR-P0-2｜修复无人值守 per-session 判定**
- `supervisor.py` `_session_unattended_enabled` 接受 `True / "1" / "true"`（大小写无关）；或在 `_load_scratchpad_sync` 回填时把已知布尔键规范化为 bool。
- AC：scratchpad 持久化为 `"1"` 后重启，supervisor 仍识别该 session 为无人值守并产生续跑日志。

**FR-P0-3｜hung 续跑可打断**
- `source=supervisor` 的 auto-continue 在 `execution_state=running` 且静默超阈值时，复用 `desktop_manual` 的 interrupt 流程（先 `request_interrupt` → 等 idle/interrupted → 再续跑）。
- AC：running 态 hung 会话，supervisor 能成功打断并发起续跑，续跑计数 +1。

**FR-P0-4｜静默信号文案升级**
- 前端 `ChatPane` 静默指示从「静默 Ns」升级为分级文案：
  - 0–阈值：`正在思考…`（动态三点）
  - 阈值–2×：`模型响应较慢（已等 Ns）· [立即重试] [换模型] [停止]`
  - >2×：`可能已卡住 · [接管] [换模型] [停止]`（黄色警示，居中主视区）
- AC：三档文案随 `silentSeconds` 切换，且操作按钮可点击生效。

### P1 — 自愈闭环（两周内）

**FR-P1-1｜Provider 连接级超时与 fallback**
- LLM provider 请求设 connect/read 超时；连续 2 次超时自动建议/切换 `STALL_MODEL_FALLBACKS` 中的快速模型（用户可在设置里关）。
- AC：主模型不可用时，会话在两轮内切到 fallback 并继续，不停在转圈。

**FR-P1-2｜Tool 轮次绕路收敛（loop guard 扩展）**
- 复用 `loop_detector.py`：同一工具连续 N 次失败/相同结果（如 guard 反复拒绝 `skill_manage`）后，强制 agent 停止该路径并向用户汇报「X 被安全策略拦截 N 次，需人工确认是否改走 file_write / 调整内容」。
- AC：guard 连拒 3 次后不再无脑重试，转为一条可见的求助消息。

**FR-P1-3｜Todo 与磁盘 reality 对账**
- 续跑/结束时，若 sticky todo 仍 in_progress 但对应产出已落盘（文件存在/命令 exit 0），自动 promote 为 completed（`resolveStickyTodoDisplay` 已有 `promotePending`，需在 supervisor/结束路径接线）。
- AC：SKILL.md 已写入后，sticky bar 不再卡在「更新 SKILL.md」。

**FR-P1-4｜skill_manage guard 反馈可操作化**
- guard 拒绝时返回结构化原因（命中类别 + 摘要 + 建议动作），前端展示「为何被拦 + 一键改用安全写法」，不再裸 `dangerous (N findings)`。
- AC：拦截消息含可读类别与下一步建议。

### P2 — 体验打磨（机会窗口）

**FR-P2-1｜会话健康度 chip**
- 状态区增加「健康度」：正常 / 慢 / 卡住，聚合 silentSeconds + execution_state + provider 延迟。

**FR-P2-2｜后台续跑透明化**
- supervisor 每次续跑在会话内留一条可折叠「无人值守续跑 · 原因 · 第 N 轮」，用户随时可见自愈过程。

**FR-P2-3｜「一键接管」入口常驻**
- 卡住态提供「我来接管」按钮：停止 agent、保留上下文、聚焦输入框，降低用户「干等」的焦虑。

---

## 3. 非功能需求

- **NFR-1 兼容**：新增 timeout/标志均走 `~/.agenticx/config.yaml`，缺省值保守，不破坏现有会话恢复。
- **NFR-2 性能**：超时与对账逻辑不得增加正常轮次的可感知延迟（对账仅在续跑/结束触发）。
- **NFR-3 可观测**：所有自愈动作（重试/切模型/打断/promote）写 supervisor 日志，便于复盘。
- **NFR-4 范围**：不改 guard 安全判定标准、不改 agent_runtime 工具序列清洗逻辑、不动 enterprise 网关侧。

---

## 4. 技术方案要点（按文件）

| 文件 | 改动 |
|------|------|
| `agenticx/runtime/agent_runtime.py` | LLM 轮次 `wait_for` 超时 + 重试钩子（FR-P0-1） |
| `agenticx/studio/supervisor.py` | `unattended_enabled` 宽松判定（FR-P0-2）；hung running 续跑前 interrupt（FR-P0-3）；续跑日志透明（FR-P2-2） |
| `agenticx/studio/continuation.py` | 续跑前置 interrupt 流程抽公共函数，supervisor/manual 共用 |
| `agenticx/memory/session_store.py` | scratchpad 布尔键反序列化规范化（FR-P0-2 备选） |
| `agenticx/runtime/loop_detector.py` | 工具绕路收敛扩展（FR-P1-2） |
| `agenticx/llms/*provider.py` | connect/read 超时 + fallback（FR-P1-1） |
| `desktop/src/components/ChatPane.tsx` | 分级静默文案 + 操作按钮（FR-P0-4）；接管入口（FR-P2-3） |
| `desktop/src/utils/task-stall-policy.ts` | 三档阈值与文案策略 |
| `desktop/src/components/StickyTaskBar.tsx` | todo/磁盘对账 promote 接线（FR-P1-3） |
| `skill_manage` 工具 + guard 返回层 | 结构化拒绝原因（FR-P1-4） |

---

## 5. 验收场景（端到端）

1. **Provider 挂起**：人为让模型 200s 无响应 → ~180s 出现「响应较慢/可能卡住」+ 自动重试/切换，不无限转圈。
2. **无人值守自愈**：开无人值守、制造静默 → supervisor 在阈值后自动续跑（有日志），无需手动点。
3. **guard 绕路**：连续触发 skill guard 拒绝 → 3 次后转人工求助消息，tool 轮次不爆炸。
4. **进度可信**：产出已落盘但 todo 未勾 → sticky bar 自动补勾，不误导。
5. **一键接管**：卡住态点「我来接管」→ agent 停止、上下文保留、输入框聚焦。

---

## 6. 里程碑

- **M1（P0，本周）**：FR-P0-1~4，消除「无声无限转圈」。
- **M2（P1，两周）**：FR-P1-1~4，形成自愈闭环。
- **M3（P2，机会窗口）**：FR-P2-1~3，焦虑感与透明度打磨。

每个 FR 落地须配 `tests/` 冒烟（超时/续跑/对账/loop guard），commit 用 `/commit --spec=.cursor/plans/2026-06-08-near-stuck-prevention.plan.md`。

---

## 7. 风险与边界

- LLM 轮次超时设太短会误杀正常长推理 → 默认 180s 偏保守，且重试一次而非直接失败。
- fallback 切模型可能改变回答风格 → 必须可关、且在会话内明确标注「已切换至 X」。
- todo 自动 promote 误判风险 → 仅当对应产出有磁盘/exit 证据时才 promote，保留 `interrupted` 不 promote。
- 不在本 plan 内：guard 安全规则放宽、agent_runtime 主循环重构、enterprise 网关限流。

---

*Made-with: Damon Li*
