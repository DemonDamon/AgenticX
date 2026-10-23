# B 端案例库 Master Plan v2 — 垂直切片版

> **分支**: `case-library-vertical-slice`
> **日期**: 2026-10-23
> **状态**: 执行中
> **v1 → v2 修正**: v1 阶段一为"水平基座统一"（Plan DSL + 护栏统一 + orchestrator 抽层先行）；v2 修正为**垂直切片优先**——先用最小改动跑通"交付 → 沉淀 → 消费"闭环，横向能力（护栏统一/红线评测/编排收口）等真实交付流量暴露痛点后按需做。

---

## 一、北极星

> **案例库 = 项目资产的结构化沉淀 + 新项目初始化时可消费的知识飞轮**

验证标准（唯一重要指标）：**新项目冷启动时间可量化缩短**。一个真实需求走完 delivery 全链（真 Agent + 真 Gate），产物自动编译进 wiki，生成 case-entry，新项目能检索到并注入初始化。

## 二、已定决策（不再讨论）

| # | 决策 | 结论 |
|---|------|------|
| D1 | 存储格式 | **Markdown + YAML frontmatter**，不引入独立 yaml。case-entry 的结构化字段全放 frontmatter，Near 桌面端零改动可渲染 |
| D2 | 存储 | **Git 文件**（`cases/{org}/{domain}/{slug}.md`），关系查询用编译期生成的索引 JSON；不引入 Neo4j |
| D3 | 编译频率 | **事件触发 + 队列 debounce + 模型分层**。复用 `wiki_compile_queue.py`。会话增量用便宜模型，人工确认的完整 case 编译用标准模型 |
| D4 | 种子案例 | 不用五企业案例（无 artifacts）。种子 = AgenticX 自身落地本计划的过程（吃狗粮） |
| D5 | 多租户 | 路径第一天带 org 前缀 `cases/{org}/{domain}/`，V1 只有 default org，后续免迁移 |

## 三、Sub Plans 与依赖

| SP | 名称 | 依赖 | 批次 |
|----|------|------|------|
| SP-A | Plan DSL v1 + Gate 结构化契约 | 无 | 1 |
| SP-C | 沉淀触发 + Case Entry 数据模型 | 无 | 1 |
| SP-B | Delivery 阶段 Agent 化 | SP-A | 2 |
| SP-D | 消费路径（检索 + 初始化注入） | SP-C | 2 |
| SP-E | 桌面端集成 + CLI + E2E | SP-B/C/D | 3 |

```
批次1（并行）: SP-A ──┬──► 批次2（并行）: SP-B ──┬──► 批次3: SP-E ──► Master E2E 验收
              SP-C ──┴──►              SP-D ──┘
```

## 四、明确不做（本切片）

- 不抽 `orchestrator/` 大层（93 个 runtime 文件重构，无即时价值）
- 不做红线评测集（无真实交付流量前是拍脑袋）
- 不做四层护栏统一 / Agent Card 市场 / 可视化编排（阶段三以后）
- 不动 `desktop/src/components/SettingsPanel.tsx`、`QrConnectModal.tsx`、`fresh-task-workspace.ts`（用户本地有未提交改动，冲突风险）
- 不做多租户隔离逻辑（只做路径前缀约定）
- 不改 enterprise/ 目录任何代码（本切片只做核心仓 + 桌面端渲染验证）

## 五、Master Agent 验收清单（端到端）

1. **单元/回归**：`python -m pytest tests/ -k "plan_mdc or case or wiki_compile or delivery" -x -q` 全绿；既有测试零回归
2. **切片闭环（CLI）**：从一条真实需求文本出发 → delivery 流水线跑完（真 Agent 产物，非 stub）→ wiki 页面 + case-entry 自动生成 → `agenticx case search <query>` 检索命中 → `agenticx case init --case <id>` 注入新项目
3. **桌面端（computer use 真机验收）**：Near 桌面端 WikiBrowseView 能树形/图谱渲染 case 页面，frontmatter 字段（type=case/scope/lifecycle）正确显示
4. **Git 卫生**：所有改动在本分支，按 SP 分 commit，不污染用户本地未提交的 desktop 改动
