---
title: AgenticX 案例库垂直切片落地
type: synthesis
sources:
  - plans/b-end-case-library/
---

> type: case | case_id: case-agent-dev-case-library-slice-v1

# AgenticX 案例库垂直切片落地

## 问题

AgenticX 的 runtime 已积累 93 个文件，却是典型“库思维”的产物：能力以 skills/agents/文档的形式堆叠，从未被一条真实交付链路完整消费过；早期规划中的“水平基座统一”（重构 orchestrator、统一护栏）投入大、见效慢，且没有真实交付流量可以验证。与之对应，delivery 流水线长期处于 stub 状态：阶段产物没有质量门，交付经验散落在一次性的 worktree 里，项目结束即蒸发，不可检索、不可复用。B 端客户要的不是更多的库，而是产品闭环——项目经验可沉淀、可检索、可注入新项目，让新项目冷启动时间可量化缩短。

## 方案

采用“垂直切片优先”策略（见 plans/b-end-case-library/MASTER-PLAN.md）：不做大重构，用最小改动先跑通“交付 → 沉淀 → 消费”闭环，横向能力等真实流量暴露痛点后按需做。拆为五个 Sub Plan：

- SP-A Plan DSL v1 + Gate 结构化契约：plan.mdc 增加 intent/scope/case_refs 字段；Gate 评审输出结构化契约（stage/severity/message），validate_stage_with_gate 统一判定阶段是否放行。
- SP-B Delivery 阶段 Agent 化：RequirementsAgent / DesignAgent 真实产出阶段文档，llm_gate_judge 质量门评审，替换原有 stub。
- SP-C 沉淀触发 + Case Entry 数据模型：on_stage_passed 事件回调 + 指纹去重 + 队列 debounce；CaseEntry 采用 Markdown + YAML frontmatter，Git 文件存储于 cases/{org}/{domain}/{slug}.md，关系查询用编译期生成的 index.json。
- SP-D 消费路径：search_cases 关键词检索（summary/problem/solution 加权打分）+ init_project_from_case 将案例注入新项目初始化。
- SP-E 桌面端集成 + CLI：agenticx case compile / search / init 三条子命令；桌面端零前端改动，复用 WikiBrowseView 既有渲染通道展示案例。

关键决策：md+frontmatter 让桌面端零改动可渲染（D1）；Git 文件存储，不引入 Neo4j（D2）；事件触发 + debounce + 模型分层控制编译成本（D3）；路径第一天带 org 前缀，V1 只有 default org 但后续多租户免迁移（D5）。

## 结果

批次 1/2 全部落地：52 个测试全绿（tests/test_case_entry.py、tests/test_case_consume.py 等），既有测试零回归。CLI 闭环可用：agenticx case compile 从 plan.mdc 编译案例并落盘，case search 关键词检索命中，case init --case 注入新项目。本案例（case-agent-dev-case-library-slice-v1）即该闭环的第一个产物——按决策 D4“吃狗粮”，用本计划自身的落地过程作为种子案例；案例正文同步渲染为 wiki/synthesis/case-library-slice.md，可在桌面端 WikiBrowseView 中直接浏览。
