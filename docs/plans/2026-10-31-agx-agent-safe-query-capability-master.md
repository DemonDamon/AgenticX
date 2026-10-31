# AgenticX Agent 安全查询与读门面加固 — Master Plan

> **状态**：Completed（2026-10-31 Asia/Shanghai）— W1–W6 已 squash 合入；本篇含合入 SHA  
> **合入 SHA（main）**  
> - W1 #179 `ebaf8b56828bc10a5999cb81f04fd524497fa686`  
> - W3 #181 `0279c7252af35bb326442cb59ad7f7730156b2d7`  
> - W2 #180 `270d7439529b49b62c6ad01646d22930fe257404`  
> - W5 #182 `c84fc1e2303408bf3746bfeebab091af304a13e4`  
> - W4 #183 `d22cc8b9cf10651acee980a95a0483183f742966`  
> - W6 #184（本 PR / 证据合入后补全）  
> **日期**：2026-10-31（Asia/Shanghai）  
> **作者**：DemonDamon（提交作者身份；执行可由 agx 开发协助）  
> **读者**：产品 / 平台研发  
> **性质**：主仓通用平台能力（可复用）；不含客户 B-pack / 业务耦合交付物  

---

## 0. 一句话目标

把 AgenticX 里已经散落的「Agent 只能安全地读、写要开门禁、查询要有统一入口、复杂操作可先讲解再执行」收成**一套可测、可演示、可端到端点通的平台能力**，用**一个复杂业务案例**证明整条链路闭环，而不是再堆互不相通的局部开关。

---

## 1. 背景与问题

当前主仓已具备：

- Data Suite：通道、治理字典、NL2SQL 只读执行与 write_guard
- Rules & Knowledge：知识对象生命周期、GraphStore（Neo4j/memory/file）、邻域/子图查询
- MCPHub：外部 MCP 工具发现与调用

缺口不在「有没有图、有没有问数」，而在：

1. **写权限语义不统一**（NL2SQL、MCP 工具面、知识写路径各说各话）
2. **读路径入口分散**（调用方容易绕过推荐查询面直打底层）
3. **缺少「只讲解不执行」模式**（复杂 SQL / 发布动作难以对人审）
4. **写入副作用策略未写成可测不变量**（校验失败 vs 次要索引失败如何暴露）
5. **缺少一条端到端复杂案例**把上述能力串成可点击验收

本计划补齐上述缺口。**不引入第二套图引擎、不引入新的专用查询方言、不新增重型外部运行时依赖。**

---

## 2. 成功长什么样（验收北极星）

在 Enterprise 管理端 + 既有 Data Suite / 知识治理页面上，用**一个复杂案例**端到端点通：

> **案例名（建议）：「华东零售 · 月度经营问数 + 知识图核验」**  
> 业务可读：运营同学要查「某大区上月 GMV 与退货率」，系统先给出只读 SQL 讲解；确认后执行；再把相关指标/表知识从知识库发布进图；Agent/管理员用统一读接口核验图上的实体邻域；全程任何写动作在未开闸时必须被结构化拒绝。

验收必须同时满足：

| # | 断言 | 证据形态 |
|---|------|----------|
| A1 | 未开写闸时，写类工具/非只读 SQL **被拒**，错误码稳定可测 | pytest + UI/API 截图或 Playwright |
| A2 | 开「讲解模式」时，**不落库执行**，只返回计划/SQL 草案 | pytest + UI 可见文案 |
| A3 | 讲解确认后，只读执行成功，结果可展示 | Playwright 或 API+截图 |
| A4 | 知识对象走审阅→发布→GraphStore；`neighborhood`/`subgraph` 可读到预期节点边 | pytest + 管理端点击截图 |
| A5 | 次要副作用失败（如可选索引）**不伪装成整单成功**；主写成功时以 Warning 暴露 | 单测 + 案例日志 |
| A6 | 全程无新查询方言、无第二 GraphStore SoT、无客户私有 pack 进 `agenticx/` | PR 审查清单 |

---

## 3. Main 准入闸门与非目标

### 3.1 准入（可进 `agenticx/` / enterprise 通用面）

- 通用、可复用、平台级契约或能力
- 有自动化测试；关键路径有 E2E 点击或等价 API 编排录像/截图
- 中文产品文案一致（演示数据不用中英混杂黑话）
- Git 作者仅为 Damon 配置身份；无虚构 Co-authored-by
- prefer-zero-new-deps（本计划默认 **0** 新运行时依赖）

### 3.2 明确非目标

- 不实现新的管道式查询语言
- 不替换 Neo4j GraphStore，不并行维护第二套图 SoT
- 不改写 Data Suite pack 为另一套对象模型格式
- 不把客户 B-pack / 私有配置放进 `agenticx/`
- 本计划不做「运维 CMDB 对象图」新产品线（若未来单独立项，另开 plan）

---

## 4. 能力条目（平台矩阵增量）

| ID | 名称 | 用户可感知价值 | 主要落点 |
|----|------|----------------|----------|
| C1 | Agent 写闸统一契约 | 没开门就不能改；拒绝原因说人话且机器可解析 | `write_guards`、MCPHub 工具元数据、NL2SQL |
| C2 | 图读统一门面 | 查图只走推荐 API（邻域/子图），文档与 SDK 一致 | `graphers/store/protocol.py`、`query.py`、可选 thin 只读工具 |
| C3 | 讲解 / 计划模式 | 复杂问数可先看将要做什么，再执行 | NL2SQL 模板与管理端/会话入口 |
| C4 | 写路径校验与副作用分级 | 主写与次要步骤失败语义清晰 | K3 publish、pack import、GraphStore upsert 路径 |
| C5 | 复杂案例 E2E 闭环 | 证明不是散件，是完整问题闭环 | enterprise e2e + 脚本化案例 + 截图/手册增量 |

---

## 5. 总体架构（怎么接到现有栈上）

```text
[管理端 / Agent 会话]
        │
        ├─ NL2SQL ──► mode=explain | execute
        │                │              │
        │                ▼              ▼
        │           计划/SQL草案    WriteGuard + ReadOnlySqlExecutor → Channel
        │
        ├─ 知识治理 ──► 审阅/发布 ──► GraphStore.upsert_*
        │                              │
        │                              ▼
        │                     neighborhood / subgraph（唯一推荐读面）
        │
        └─ MCPHub ──► 工具元数据带 write_requires_enable
                         未开闸 → 稳定错误码（与 NL2SQL 同源契约）
```

原则：**加薄契约层与模式开关，不换引擎。**

---

## 6. 工作流拆分：串行主干 + 可并行支线

### 6.1 推荐执行拓扑

```text
W0 契约与矩阵文档 ─────────────────────────────┐
        │                                        │
        ▼                                        │
W1 C1 写闸契约（库内） ──► W2 C3 讲解模式         │  （W1 完成后 W2 启动；可与 W3 并行调研）
        │                     │                  │
        │                     ▼                  │
        │              W4 管理端/会话接线（依赖 W2）│
        ▼                                        │
W3 C2+C4 读门面与写不变量（可与 W2 并行编码） ◄───┘
        │
        ▼
W5 复杂案例数据与脚本（依赖 W1–W4 接口冻结）
        │
        ▼
W6 端到端点击验收 + 缺陷回修（串行收口，铜管负责）
        │
        ▼
W7 文档/操作手册增量 + PR 合入 main
```

- **必须串行**：W0 → W1 →（W2 与 W4）→ W5 → W6 → W7  
- **可并行**：W2 与 W3（不同模块文件面，冲突面小）  
- **W6 只能一人/一管收口**：端到端点击与「问题是否闭环」判定不并行分叉，避免各说各话。

### 6.2 子智能体 / 工作线程建议

| 线程 | 负责 | 并行？ |
|------|------|--------|
| 管主（本会话 / 铜管） | 契约拍板、接口冻结、W6 E2E、合入 | — |
| 执行 A | W1 写闸 + 单测 | 先 |
| 执行 B | W2 讲解模式 + 单测 | W1 后，可与 C 并行 |
| 执行 C | W3 读门面文档化 + publish 不变量测试 | 可与 B 并行 |
| 执行 D | W4 UI/会话接线 + Playwright | W2 接口稳定后 |
| 执行 E | W5 案例 fixture + 中文场景文案 | W1–W4 接口清单冻结后 |

---

## 7. 可执行工作包（Work Packages）

### W0 — 能力矩阵与错误码契约（文档，半日级）

**产出**

- `docs/plans/2026-10-31-agx-agent-safe-query-capability-master.md`（本文）确认版
- 短 ADR 或结论附录：`docs/concepts/` 或 `conclusions/` 下新增一页「Agent 读写契约」
  - 错误码表（至少）：`write_guard_denied`、`write_tools_disabled`、`explain_only_no_execute`、`invalid_query_mode`
  - 模式枚举：`explain` | `execute`（默认 `execute` 保持兼容）

**步骤**

1. 冻结错误码字符串与 JSON 字段名（`code` / `reason` / `mode`）
2. 列出将修改的模块清单（见 §8）
3. Damon 确认本文后勾选开工

**完成标准**：错误码表评审通过；后续 PR 不得另发明新同义码。

---

### W1 — C1 写闸统一契约（库内）

**文件（预期）**

- 修改：`agenticx/managed/templates/data_suite/write_guards.py`
- 修改：`agenticx/managed/templates/data_suite/nl2sql.py`（对齐错误形状）
- 修改：`agenticx/tools/mcp_hub.py`（工具快照增加 `requires_write_enable` 或等价元数据；调用前检查）
- 测试：`tests/managed/templates/test_nl2sql.py` 及新增 `tests/tools/test_mcp_hub_write_gate.py`（路径以落地为准）

**步骤**

1. 定义 `WriteGateDecision`（或扩展现有 `WriteGuardPolicy`）：`allowed: bool`、`code`、`reason`
2. NL2SQL 拒绝路径全部改走同一 `code`（保留现有 `write_guard_denied` 前缀兼容或映射）
3. MCPHub：对标记为写的工具，默认拒绝并返回契约错误；提供显式 enable 配置位（环境/配置，默认关）
4. 单测：未开闸拒绝；开闸后写工具可调用（可用 fake MCP）
5. 提交独立 PR：`feat(agent): unify agent write-gate contract`

**完成标准**：相关 pytest 绿；无行为回退（默认仍拒绝危险写）。

---

### W2 — C3 NL2SQL 讲解模式

**文件（预期）**

- 修改：`agenticx/managed/templates/data_suite/nl2sql.py`
- 修改：managed agent 模板/manifest 入参（若有 mode 字段）
- 测试：`tests/managed/templates/test_nl2sql.py`、`test_nl2sql_llm.py`

**步骤**

1. 增加 `mode: explain | execute`（默认 `execute`）
2. `explain`：生成/返回 SQL（或计划结构），**禁止**调用 channel 执行
3. `execute`：保持现有只读执行 + write_guard
4. 非法 mode → `invalid_query_mode`
5. 单测覆盖三态：explain / execute 成功 / 非只读 execute 拒绝
6. PR：`feat(data-suite): nl2sql explain mode`

**完成标准**：默认行为不变；explain 路径零执行副作用（可用 mock channel 断言未调用）。

---

### W3 — C2 读门面 + C4 写不变量

**文件（预期）**

- 文档：GraphStore 推荐读法（可写在 `agenticx/knowledge/graphers/store/` README 或 `docs/`）
- 修改：`agenticx/knowledge/graphers/incremental/publish.py`（如需统一返回 `warnings`）
- 测试：publish / GraphStore 邻域查询回归

**步骤**

1. 明确对外稳定 API：`neighborhood`、`subgraph`（及现有 CLI `query_cli` 若保留则指向同一实现）
2. 禁止在示例/托管模板中直连 Neo4j driver 绕过 Protocol（加 lint 说明或 code review 清单即可）
3. publish：主路径 upsert 成功/失败语义；次要步骤失败进入 `warnings` 列表且 `ok` 语义不撒谎
4. 单测：邻域查询；publish 带 warning 的夹具
5. PR：`feat(knowledge): graph read facade invariants`

**完成标准**：协议测试绿；文档指出「唯一推荐读面」。

---

### W4 — 管理端 / 会话接线（可点击）

**文件（预期）**

- Enterprise 问数/数据套件相关 UI（调度或 NL 会话入口，以现网页面为准）
- 知识治理发布相关 UI（已有则增量：展示 warnings / 模式）
- Playwright：`enterprise/e2e/tests/...` 新增或扩展

**步骤**

1. UI 增加「讲解 / 执行」切换（中文文案）
2. 写闸拒绝时页面展示可读原因（映射错误码）
3. 知识发布后提供「查看邻域」入口或结果面板（最小可用）
4. Playwright：覆盖案例关键点击路径（详见 W6）
5. PR：可与 W2 同 PR 或 follow-up，避免长期双轨

**完成标准**：不看日志也能在 UI 完成讲解→执行→看图。

---

### W5 — 复杂案例夹具与脚本

**案例规格（冻结文案，中文）**

- 组织：华东零售演示租户（虚构，非真实客户数据）
- 问句：`上月华东大区 GMV 和退货率分别是多少？`
- 知识对象：至少 2 实体（指标「GMV」、指标「退货率」或表「订单事实」）+ 1 关系（指标依赖表）
- 通道：使用现有 golden-path / 测试通道（优先内存或已有 fixture，避免强依赖外部 Hive）

**步骤**

1. 准备 seed：字典字段、最小表/通道 fixture、知识对象 draft
2. 脚本或 notebook/pytest 编排：explain → execute → publish → neighborhood 断言
3. 中文 UI 文案与种子数据无中英混杂

**完成标准**：一条命令或一条 pytest 可在 CI/Mac 复现 API 级闭环；为 W6 点击提供稳定数据。

---

### W6 — 端到端点击验收（铜管收口，不可跳过）

**环境**：Damon Mac 本地 Enterprise（或既定 demo 栈）；Neo4j 按现有 env；LLM 按「彩讯-外网」配置（live）或讲解路径可用 scripted 兜底——**执行路径至少一条 live 或真实 channel fixture**。

**点击剧本（必须按序录屏或截图）**

1. 打开问数/数据套件相关页，输入案例问句，选 **讲解**
2. 确认页面展示 SQL/计划，且库侧无查询执行痕迹（或 mock 断言）
3. 切换 **执行**，得到结果表/数字
4. 故意触发一次写闸（如尝试非只读 SQL 或写工具）→ 看到拒绝提示
5. 进入知识治理：提交审阅 → 发布案例知识对象
6. 打开邻域/子图视图（或触发只读查询工具）→ 看到案例实体与边
7. （可选）制造次要 warning 夹具 → UI/返回体可见 warnings

**完成标准**：A1–A6 全部勾选；缺陷开 issue/同 PR 热修直到闭环；输出截图目录（例如 `docs/agx-data-suite/shots/safe-query-e2e/`）或 e2e 产物。

---

### W7 — 文档与合入

**步骤**

1. [x] 更新 Data Suite 操作手册相关小节（仓库 MD 指针；飞书 wiki 由库洛洛增量，若 CLI 不可用则记 residual）
2. [x] PR 描述含：能力矩阵条目、E2E 证据链接、非目标清单
3. [x] squash merge W1–W5；作者仅 Damon；Mac main ff（W6 本 PR）
4. [x] 本 master plan 状态改为 Completed 并注明合并 SHA

---

## 8. 关键文件面（实施时以实际 diff 为准）

| 区域 | 路径 |
|------|------|
| 写闸 | `agenticx/managed/templates/data_suite/write_guards.py` |
| NL2SQL | `agenticx/managed/templates/data_suite/nl2sql.py` |
| MCP | `agenticx/tools/mcp_hub.py` |
| GraphStore | `agenticx/knowledge/graphers/store/{protocol,query,factory,neo4j_store}.py` |
| 发布 | `agenticx/knowledge/graphers/incremental/publish.py` |
| 测试 | `tests/managed/templates/test_nl2sql*.py`；knowledge/graphers 相关 tests |
| E2E | `enterprise/e2e/tests/**` |
| 计划/文档 | `docs/plans/2026-10-31-agx-agent-safe-query-capability-master.md`；ops 手册增量 |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 讲解模式被误当成已执行 | UI 强提示「未执行」；API `mode` 与 `executed: false` |
| 写闸收口误伤既有 MCP 写场景 | 默认与今日一致；仅规范化错误；enable 配置显式文档化 |
| E2E 依赖外部 LLM/网不稳定 | explain 可用 scripted；execute 用 fixture channel；live LLM 作加分项 |
| 并行 PR 冲突 | W2/W3 分目录；W4 等接口 freeze tag |
| 范围膨胀到对象图产品 | 非目标写死；新需求另开 plan |

---

## 10. 工期量级（供排期，非承诺）

| 包 | 量级 |
|----|------|
| W0 | 0.5d |
| W1 | 1–2d |
| W2 | 1–2d |
| W3 | 1–2d |
| W4 | 2d |
| W5 | 1d |
| W6 | 1–2d（含返工） |
| W7 | 0.5d |

并行后日历大约 **1.5–2.5 周**（单线程则更长）。

---

## 11. 确认清单（开工前勾选）

- [ ] 认同目标：统一写闸 + 讲解模式 + 图读门面 + 复杂案例 E2E，不换引擎
- [ ] 认同非目标清单 §3.2
- [ ] 复杂案例文案可用，或提供替换中文场景
- [ ] E2E 在 Mac Enterprise 环境执行（铜管负责收口）
- [ ] 确认后拆出 W1–W7 的可执行 subplan（每包独立 checkbox 步骤）再编码

---

## 12. 确认后的下一步

1. 将本文标记为 **Accepted**  
2. 按 W1→W7 生成独立 executable subplans（每包一篇短 plan 或同一目录下 `…-w1-….md`）  
3. 启动执行：W1 优先；W2∥W3；W6 由铜管端到端点击收口  

**在 Damon 明确「按此 master plan 开工」之前，不改生产代码。**


---

## Accepted 记录

- 2026-10-31：Damon 确认按此 master plan 开工；拆 W1–W7 executable subplans 并开始执行。


## Completed 记录

- 2026-10-31（Asia/Shanghai）：W1–W5 squash 合入 main；W6 证据 + W7 文档指针随 #184 / follow-up 合入。
