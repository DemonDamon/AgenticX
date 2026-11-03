# SP6 切换保真度评测报告（harness-control-surface）

Plan-Id: 2026-11-03-harness-control-surface-master
Date: 2026-11-03
Evaluated-on: feat/harness-control-surface @ a6b719c24（SP5b 全量交付后）
Script: `research/codedeepresearch/harness-control-surface/sp6_fidelity.py`（副本；原始运行位置 /tmp/sp6_fidelity.py）

## 一、评测设计

**目标（对应 MASTER-PLAN SP6 验收）：** 量化「同一任务中途切换底层 harness N 次」的上下文存活率、任务完成率与 handoff 摘要契约符合度。

**环境（真实服务器，非 mock）：**
- 真实 studio 服务器（隔离 HOME、独立端口 19810、desktop-token 鉴权）
- A 侧 = **真实 OpenCode CLI + 真实 LLM**（埋锚点、召回探针均由真模型执行）
- B 侧 = **codex 协议桩**（`codex exec --json` 录制协议回放；本机未装 codex CLI，按纪律 #6 以桩代跑，装好后同脚本复验）
- 每个 seed 独立服务器 + 独立隔离 HOME，互不污染

**每个 seed 的流程（3 seeds × 4 次切换）：**

```text
绑定 opencode
→ turn1/turn2（真 LLM）：埋 3 个锚点 + 任务状态（4 节任务的前 2 节完成）
→ 切 codex（第 1 次切换，A→B）→ 桩 turn
→ 切回 opencode（第 2 次，B→A resume）
→ turn3（真 LLM）：存活探针——不给任何新信息，要求按原顺序列出全部锚点
→ 再切 codex（第 3 次）→ 桩 turn → 切回 opencode（第 4 次）
→ turn4（真 LLM）：完成探针——三锚点按原序一行输出 + 报告哪两节已完成
```

**Seeds（锚点 / 任务 / 任务节均不同）：**

| seed | 锚点 | 任务 | 任务节 |
|---|---|---|---|
| 0 | ALPHA-7Q4 / BETA-9K2 / GAMMA-5D8 | payment reconciliation report | 数据导入 / 对账规则 / 差异清单 / 税额核对 |
| 1 | ORION-3X9 / LYRA-8M1 / VEGA-2T6 | supplier risk scoring model | 特征工程 / 评分卡 / 回测 / 监控面板 |
| 2 | NADIR-5C3 / ZENITH-7H8 / ECHO-4R2 | customer churn analysis deck | 队列定义 / 流失归因 / 挽留实验 / 汇报页 |

**度量项：**
1. **planted**：turn1/turn2 的指令性回执（NOTED/UPDATED）是否出现（真 LLM 听话基线）
2. **survival**：A→B→A 后锚点召回 N/3（不提供新信息）
3. **completion**：4 次切换后三锚点有序召回（keys_ok + order_ok）+ 任务状态召回（sections_ok）
4. **switches**：4 次切换的 HTTP 状态 + 实际策略 + B→A 时是否 resume 原生 `ses_*` 线程
5. **summary 契约抽检**（每条 handoff 记录 8 项，程序化）：goal 非空 / goal 含任务关键词 / goal 含首锚点 / 八段全部在场 / 八段全部有值（"(none recorded)" 占位符按契约算有值）/ decisions 携带实际活动（非占位）/ 任务状态进入摘要

## 二、结果汇总

| seed | planted | survival | completion | switches | summary 抽检 |
|---|---|---|---|---|---|
| 0 | ✓ | **3/3** | **✓**（keys+order+sections） | 4×200：full_summary → resume(原生线程✓) → resume → resume | 4 条 handoff × 8 项 **全过** |
| 1 | ✓ | **3/3** | **✓** | 同上 | 4 条 × 8 项 **全过** |
| 2 | ✓ | **3/3** | **✓** | 同上 | 4 条 × 8 项 **全过** |

**合计：** 9/9 锚点存活；3/3 任务完成；12/12 切换全部 200；12 条 handoff 记录 × 8 项契约检查 = **96/96 全过**。

**完成探针原文（4 次切换后的最终回答）：**

```text
seed 0: ALPHA-7Q4 BETA-9K2 GAMMA-5D8
        Sections 1 (数据导入) and 2 (对账规则) are finished.

seed 1: (a) ORION-3X9 LYRA-8M1 VEGA-2T6
        (b) Sections 1 (特征工程) and 2 (评分卡) are finished.

seed 2: NADIR-5C3 ZENITH-7H8 ECHO-4R2
        Sections 1 (队列定义) and 2 (流失归因) are finished.
```

## 三、摘要抽检样本（seed 0）

**第 1 次切换（opencode → codex，full_summary）：**

```text
[goal]   We are working on a payment reconciliation report. The first access
         key is ALPHA-7Q4. We have finished section 1: 数据导入. ...
[decisions] - NOTED
            - UPDATED
[checkpoint_diff] 2 run(s) in scope (full thread); 0 file(s) changed.
（changed_files / commands_and_tests / plan_and_todos / open_approvals /
 known_failures 均为 "(none recorded)" 占位——纯对话任务，符合预期）
```

**第 2 次切换（codex → opencode，resume）：**

```text
[goal]   （与上同——goal 恒取首条用户消息，任何策略下目标不丢）
[decisions] - CODEX-STUB-DONE      ← B 侧（codex 桩 turn）的活动进入摘要
[checkpoint_diff] 1 run(s) in scope (delta since message 4); 0 file(s) changed.
                                                          ^^^^^^^^^^^^^^^^^^ delta 范围裁剪生效
```

策略阶梯符合设计：首切 full_summary（B 首次见到全量上下文），此后全部 resume（双向各自的原生线程被重挂，`ses_*` 线程 id 验证通过）。

## 四、结论

1. **上下文存活**：A→B→A 后锚点召回 9/9；再经一轮双切后完成探针仍全对（含顺序）——统一面 chat_history + resume 重挂原生线程的组合没有丢上下文。
2. **任务完成**：3/3 seeds 的最终回答同时含有序锚点 + 任务节状态；策略阶梯（full_summary→resume）按预期落位。
3. **摘要契约**：12 条 handoff 记录八段式全部在场且有值；goal 恒存（跨策略）；decisions 携带跨 harness 活动（B 侧 turn 进入 A←B 记录）；checkpoint_diff 正确反映 delta/full 范围裁剪。
4. **无代码变更**：本轮为纯评测，未发现产品缺陷，无 commit（评测脚本随本报告存档于 research/，git-ignored）。

## 五、边界与备注（如实）

- **codex 侧为协议桩**：B 侧 turn/注入由 `codex exec --json` 录制协议回放完成。注入包装到达 CLI argv 已在 SP4 E2E 实证；装好真实 codex CLI 后用同一脚本复验即可（BYOS 环境问题，非代码缺陷）。
- **memory/knowledge 注入点**：快照装配已接 `session.scratchpad → memory_snapshot` 与 todo manager → `todos`；`knowledge_snapshot` 当前为占位空串。本评测隔离会话无 scratchpad 内容，故样本中 memory_snapshot 为空——**V2 AC（切换后首轮引用 memory/knowledge）机制在场但未演示，保持未勾选**，待带真实记忆内容的会话补演示。
- 同批遗留的用户侧真机复验清单（启动/登录类，用户自测）：claude-code ark CodingPlan 订阅过期、codebuddy 需 `/login`、codex CLI 未安装；SP5b desktop 真机点验（A→B→A 边界标记可见性）。

## 六、复现

```bash
# 每 seed 起独立真实服务器（隔离 HOME + 真实 opencode + codex 桩），约 3-6 分钟
python3 research/codedeepresearch/harness-control-surface/sp6_fidelity.py 0   # 再跑 1、2
# 输出 /tmp/sp6_seed<i>.json + stdout 人类可读日志
```
