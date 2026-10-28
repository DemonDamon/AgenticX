# AGX Data Suite — After A1–A8：下一步路线图

> **Date:** 2026-10-28  
> **Context:** A1–A8 垂直切片已落地（P0–P2）。A 层「能力骨架」齐了，但距「可售可交」还差产品化、贯通与 B 层。  
> **Discipline:** 80–90% 继续进 AgenticX；10–20% 客户定制进独立仓。文档/提交继续脱敏。

## 现在我们实际到哪了（诚实盘点）

| 能力 | 已有 | 仍缺（相对原验收） |
|------|------|-------------------|
| A1 通道 | Fake + ClickHouse + 只读/授权语义 | Hive/JDBC/Kafka/文件通道未齐；真实探查 UI 薄 |
| A2 DataFlow | DSL + runner + scheduler 单测 | 与 studio/managed 调度、运维面未深绑 |
| A3 ID-Mapping | 引擎 + 快照测 | 管理台配置/冲突审阅 UX 弱 |
| A4 治理 | 字典/清洗/可信度/质量/血缘库 + admin stub | 管理台多为 fixture，非真 CRUD/日更流水线 |
| A5 标签圈选 | 元模型 + compute + audience DSL | 标签滚动运营台、下推到真通道未打通 |
| A6 看板 | 配置 board + drill/compare + admin e2e | portal 产品化、自助取数 API 权限链路未闭环 |
| A7 安全 | masking + watermark + AuthStrategyRegistry | **路由未全面改用 registry**；密级策略运营面薄 |
| A8 Agent 模板 | quality/dict-drift/nl2sql runners + examples | 未挂真 Managed schedule/webhook/metering；NL2SQL 无 LLM 闭环 |

**结论：** 通用引擎「能测、能 demo 切片」；下一阶段不是再开 A9，而是 **硬化 + 贯通 + 产品壳 + B 仓**。

## 推荐四条轨道（按优先级）

### Track 0 — 合入与收口（本周，半天级）
1. 合入 A8 PR（`feat/agx-data-suite-p2-a8`）。
2. 更新父计划 / Feishu「A1–A8 Done」状态与截图索引。
3. 写一页「能力地图 vs 验收缺口」给售前（脱敏）。

### Track 1 — 黄金路径贯通 **P3 Spine**（最高杠杆，建议先做）
做一个**不带客户名**的端到端样例仓/`examples/data_suite/golden-path/`：

`FakeChannel 探查 → DataFlow 作业 → OneID → 字典/质量 → 标签圈选 → 配置看板 → 脱敏/水印 → A8 巡检 webhook`

Done when：一条 README 命令跑通 + admin 上能点到关键页面 + 截图进 `docs/agx-data-suite/shots/`。

价值：把分散的 A1–A8 收成「可演示产品」，否则卖点仍是八个零件。

### Track 2 — A 层硬化 **P3 Harden**（按缺口补，不要平行开八条）
建议顺序（仍串行）：
1. **A7 收尾**：SSO 路由改用 `AuthStrategyRegistry`（PR note 里的 follow-up）。
2. **A1 扩通道**：优先 JDBC 或 Kafka 二选一（按下个项目通道画像选）。
3. **A4/A6 管理台**：把 governance / boards 从 fixture 升到最小可写 API + 持久化（SQLite/文件仓即可）。
4. **A8 挂调度**：quality/dict-drift 接到 managed schedule + 真 webhook 配置。

### Track 3 — B 层独立仓 **P4 Delivery Pack**（真正降交付成本）
新建独立仓（例：`agx-data-suite-customer-pack` 或项目代号仓），只放：
- B1 通道配置 / 私有适配
- B2 域字典、指标、标签清单、质量阈值
- B3 业务看板 YAML
- B4 ID 映射策略
- B5 客户 IAM strategy 插件实例
- B6 部署手册

AgenticX 主干保持零客户名。用「配置包 + register()」吃掉 10–20%。

### Track 4 — 售卖与交付包装 **P4 GTM**（可与 Track 1 并行文档）
- 架构一页纸 + A/B 边界说明（已有 SVG，补「已实现/缺口」色）
- 投标差异化话术：双 runtime、治理台、Data Agent 模板
- 实施估算模板：A 已沉淀 → 项目侧 ~15 人月量级（沿用父规划数字，按实校准）

## 不建议现在做的

- 再开新的大引擎（A9 湖仓、自建计算层）——违背「算力留客户侧」。
- 在主干写行业宽表/客户字典。
- 并行开多条产品线子代理——按你的偏好继续 **子计划串行**。

## 建议决策（选一条主航道）

| 选项 | 何时选 | 下一动作 |
|------|--------|----------|
| **S1 黄金路径** | 要尽快对外讲清楚 / demo | 写 `p3-spine` 子计划并开 `feat/agx-data-suite-p3-spine` |
| **S2 A7 路由收尾 + A1 通道** | 下个项目已锁定通道/认证 | 按项目画像排 Harden 子计划 |
| **S3 拉 B 仓骨架** | 已有明确客户实施窗口 | scaffold 独立仓 + 第一份脱敏配置包 |
| **S4 先包装文档/售前** | 近期投标优先于工程 | Track 4 文档为主，工程只合 A8 |

默认推荐：**S1 →（穿插）S2 的 A7 路由收尾 → S3**。

## Decision (2026-10-28)

- User chose **S1 黄金路径贯通**.
- Executable plans: `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-spine-index.plan.md` (S1-1…S1-5).
- Branch: `feat/agx-data-suite-p3-spine` (from A8 tip until A8 merges).
  
S1 把已有投资变成故事；S2 堵合规/接入硬伤；S3 才开始吃交付红利。

### Track 1 status (2026-10-28)

- **Done on branch** `feat/agx-data-suite-p3-spine`: `examples/data_suite/golden_path/` one-command + pytest gate.
- Push/PR still pending (same GitHub 443 constraint as A8).

### Track 2 status (2026-10-28)

- User chose **S2 A7 AuthStrategyRegistry 路由硬化** after S1.
- Plans: `.cursor/plans/pending/2026-10-28-agx-data-suite-p3-harden-index.plan.md`.
- A7 AuthStrategyRegistry route wiring **done** on spine branch (admin+portal runtimes + start protocol guards).
- User next chose **S2 A1 扩通道** → **JDBC** (not Kafka). Plan: `p3-harden-4-jdbc-channel.plan.md`.
