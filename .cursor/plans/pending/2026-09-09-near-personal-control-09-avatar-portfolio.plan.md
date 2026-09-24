# 子计划 09：Avatar Portfolio Evolution MVP

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: gpt-5.6-sol-medium
Parent-Plan: `.cursor/plans/pending/2026-09-09-near-personal-agent-control-plane-master.plan.md`
Depends-on: `2026-09-09-near-personal-control-01-run-ledger`, `2026-09-09-near-personal-control-03-observation-ledger`, `2026-09-09-near-personal-control-04-personal-eval`, `2026-09-09-near-personal-control-05-user-constitution`, `2026-09-09-near-personal-control-07-capability-changeset`
Plan-Id: 2026-09-09-near-personal-control-09-avatar-portfolio

> **For implementer:** 最后实施。MVP 只允许 suggest→candidate→人工 approve/activate→rollback。禁止自动 merge、split、retire，禁止自动改 group.yaml。

**Goal:** 让 Near 基于真实运行证据提出数字专家演进建议，创建可评测 candidate，经过用户批准后激活，并保留完整 lineage 与回滚能力。

**Architecture:** Portfolio 采用旁路 proposal/lineage/version store，不先把必填字段塞进旧 avatar.yaml；candidate 是新 avatar id，默认不进入主画廊/current。建议只读聚合 Run/Eval/Constitution，激活复用 ChangeSet 事务与 snapshot。

**Tech Stack:** AvatarRegistry、SubAgentRunStore、UsageStore、Personal Eval、ChangeSet、FastAPI、React、pytest/Vitest。

## In scope

- 只读绩效聚合与规则化建议。
- proposal 文件、candidate fork、lineage。
- Eval gate、人工 approve、activate、rollback。
- Desktop 待审卡与 candidate badge。

## Out of scope

- 自动 merge/split/retire。
- 自动修改群成员、自动路由切换、自动 promote/canary。
- 删除旧 avatar、跨用户专家市场。

## 存储

```text
~/.agenticx/avatars/.portfolio/proposals/<proposal_id>.json
~/.agenticx/avatars/.portfolio/lineage/<avatar_id>.jsonl
~/.agenticx/avatars/.versions/<avatar_id>/<version>.yaml
```

Proposal：

```json
{
  "proposal_id": "uuid",
  "action": "fork_candidate|adjust_role|adjust_model|adjust_skills|adjust_tools",
  "source_avatar_ids": ["..."],
  "target_avatar_id": null,
  "motivation": "...",
  "evidence_refs": ["run:...", "eval-report:...", "constitution:..."],
  "candidate_diff": {},
  "status": "pending|candidate_created|eval_passed|eval_failed|approved|active|rejected|rolled_back",
  "created_at": "...",
  "schema_version": 1
}
```

Lineage 每条记录含 `avatar_id/parent_avatar_id/lineage_root_id/proposal_id/forked_from_session_id/config_hash/event/created_at`。

## FR-09-1：只读 Portfolio metrics

**Files:**
- Create: `agenticx/avatar/portfolio_metrics.py`
- Modify: `agenticx/runtime/usage_store.py`，增加 `dimension="avatar"` breakdown
- Create: `tests/test_avatar_portfolio_metrics.py`

输入只读聚合：
- canonical delegate runs 的成功/失败/取消。
- usage_events.avatar_id token/cost。
- session loop_review 与 tool observations。

**AC:** 缺数据返回 unknown，不当作 0 分；严格时间窗；不同 avatar 不串；不因统计写 avatar config。

## FR-09-2：Proposal 与建议

**Files:**
- Create: `agenticx/avatar/portfolio.py`
- Create: `tests/test_smoke_avatar_portfolio.py`

规则化 suggest 首版只产提案：
- 职责高度重叠：提示人工审阅，不建议自动 merge。
- 成本升高且成功率下降：建议 model/role review。
- 高频用户纠正：引用 Observation/Constitution，建议 candidate。

**AC:** create proposal 后所有 source `avatar.yaml` 和 group.yaml byte-for-byte 不变；evidence refs 必须存在；无证据拒绝创建。

## FR-09-3：Candidate fork 与 lineage

**Files:**
- Modify: `agenticx/avatar/registry.py::AvatarConfig/create_avatar/update_avatar`，仅增加向后兼容 optional 字段
- Reuse/refactor narrowly: `agenticx/studio/server.py::fork_avatar`
- Test: `tests/test_smoke_avatar_portfolio.py`

optional 字段：
- `portfolio_status: active|candidate|archived`（缺省 active）
- `parent_avatar_id`
- `lineage_root_id`
- `activated_from_proposal`

candidate：
- 新 id；`created_by="portfolio"`。
- 继承 workspace 内容使用明确 copy policy，不与 parent 共享可写目录。
- 默认 `portfolio_status=candidate`，不替换 parent、不自动加入 group。

## FR-09-4：Eval 与激活

**Files:**
- Create: `agenticx/avatar/portfolio_service.py`
- Create: `tests/test_avatar_portfolio_activation.py`

要求：
- baseline=parent，candidate=新 avatar，在同一 Personal EvalSet shadow replay。
- `promotion_allowed=false` 时普通 approve/activate blocked。
- Constitution Boundary 冲突 blocked。
- 用户 approve 后构建只含 avatar adapter 的受控 ChangeSet 扩展；若计划 07 明确不含 avatar，则本计划新增 `AvatarChangeAdapter`，不得修改其他 adapters。
- activate 前 snapshot parent/candidate yaml；失败 current/registry 投影不变。

## FR-09-5：Rollback

**Files:**
- Create: `agenticx/avatar/portfolio_versions.py`
- Test: `tests/test_avatar_portfolio_activation.py`

要求：恢复 previous active config；candidate 标 archived 而非删除；lineage append rolled_back；重复 rollback 幂等。不得删除 candidate session/history/eval evidence。

## FR-09-6：Meta tools 与 REST

**Files:**
- Modify: `agenticx/runtime/meta_tools.py`，新增 `propose_avatar_evolution/list_avatar_proposals`
- Modify: `agenticx/studio/server.py` 在 avatar fork/generate 路由后新增 portfolio 路由，禁止改 import 区
- Test: `tests/test_avatar_portfolio_api.py`

Meta 工具只能 propose/list，不能自动 activate/delete。REST 提供 list/create/candidate/eval/approve/activate/reject/rollback；破坏性动作必须显式确认。

## FR-09-7：Desktop

**Files:**
- Modify: `desktop/src/components/gallery/AvatarGalleryView.tsx`
- Modify: `desktop/src/components/AvatarSettingsPanel.tsx`
- Modify: `desktop/src/store.ts` Avatar optional types
- Add tests/locales

展示 proposal count、candidate badge、lineage/eval evidence；批准与回滚使用主题确认框。candidate 默认不作为正常主卡/聊天入口，除非用户进入评测详情。

## 验证

```bash
pytest \
  tests/test_avatar_portfolio_metrics.py \
  tests/test_smoke_avatar_portfolio.py \
  tests/test_avatar_portfolio_activation.py \
  tests/test_avatar_portfolio_api.py \
  tests/test_smoke_create_avatar_tool.py \
  tests/test_smoke_subagent_run_store.py \
  tests/test_meta_tools.py -q
cd desktop && npm run typecheck
```

人工验收：
1. suggest 后配置/群成员不变。
2. candidate 与 parent 分别 replay，报告可追溯。
3. approve+activate 后重启仍保持。
4. rollback 恢复旧配置，candidate/evidence/lineage 仍可查。

## 强制停止条件

- 前置 01/03/04/05/07 任一未通过，不得实施。
- 统计证据不足时只展示“数据不足”，不得建议淘汰。
- 任何自动 merge/split/retire/group mutation 都视为超范围。
