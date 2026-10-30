# AGX Data Suite H5 — 自助取数 ACL + 脱敏强制

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h5-query-acl-mask`  
> **Depends on:** H4 merged (`9783c96b` / PR #171); **masking 引擎 / boards CRUD / binder 可选 masking 已合入 — DO NOT redo。**  
> **Main-repo gate:** 通用平台 ACL + 脱敏闭环；禁止客户 IAM / 业务看板内容 / delivery_pack 实体进 `agenticx/`。

**Goal:** 打通「取数 → ACL → 脱敏」闭环：
1. 可复用 **Query ACL gate**（按 role × dataset/board/field）越权 → deny / HTTP 403
2. 授权读路径 **强制** 走 `masking/policy`（不能跳过返回敏感明文）
3. Admin + 最小 portal 自助取数 query API 共用同一 gate
4. pytest / vitest / e2e 断言：越权 403 + 授权受限角色脱敏输出

**Inventory（H5 前）**

| 面 | 状态 |
|----|------|
| `masking/{engine,policy}.py` + `test_masking_engine.py` | 已有 |
| `bind_widget(..., masking=, role=)` | **可选**；可跳过脱敏 |
| `dashboard/explore.py` | 无 ACL / 无强制脱敏 |
| admin boards CRUD + `e2e-data-boards.ts` | 元数据 CRUD；无取数 ACL |
| `data-security` UI + fixture mask | 预览 stub；无 query API / 无 ACL 403 |
| portal data-suite query | **缺口**：无路由 |
| Query ACL（role×dataset/board） | **缺口** |

**Out of scope:** H6 DataFlow；A9 compute；业务看板内容；角色/密级业务定义（B 层）；重做 masking 引擎 / boards CRUD；FinnewsHunter；合并本 PR。

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/acl/policy.py` | `QueryAclPolicy` / grant / `load_query_acl_policy` |
| `agenticx/data_suite/acl/gate.py` | `check_query_access` + `QueryAccessDenied` |
| `agenticx/data_suite/acl/secure.py` | `secure_query_rows` / `secure_bind_widget`（ACL 后强制 mask） |
| `agenticx/data_suite/acl/__init__.py` | 导出 |
| `tests/data_suite/fixtures/sample_query_acl.yaml` | 脱敏假角色 grants（admin/analyst/guest） |
| `tests/data_suite/test_query_acl.py` | ACL allow/deny + field 级 |
| `tests/data_suite/test_dashboard_mask_bind.py` | 扩展 secure_bind / 强制脱敏不可跳过 |
| `enterprise/.../lib/data-query-acl.ts` | TS 镜像 ACL + `secureQueryRows`（复用 maskRows） |
| `enterprise/.../lib/__tests__/data-query-acl.test.ts` | vitest 403/mask |
| `enterprise/.../api/admin/data-suite/query/route.ts` | POST 自助取数；deny→403；allow→脱敏行 |
| `enterprise/.../api/admin/data-suite/query/__tests__/route.test.ts` | 路由级 403 / masked |
| `enterprise/apps/web-portal/.../api/data-suite/query/route.ts` | 最小 portal 入口（同 gate） |
| `enterprise/.../_sections/data-security.tsx` | 「自助取数试探」中文 UI（可选但建议） |
| `enterprise/scripts/e2e-data-query-acl.ts` | Playwright：登录后 POST query → 403 + masked |
| `messages/zh.json` (+ en 镜像键) | 新中文文案，无中英混排 UI |

## Interfaces

```python
# agenticx.data_suite.acl
class QueryAccessDenied(Exception): ...

def check_query_access(
    policy: QueryAclPolicy, *, role: str, dataset_id: str,
    board_id: str | None = None, fields: list[str] | None = None,
) -> AccessDecision: ...

def secure_query_rows(
    rows, *, role, dataset_id, acl, masking, board_id=None,
) -> list[dict]:  # raises QueryAccessDenied; always masks

def secure_bind_widget(widget, rows, *, role, acl, masking, board_id=None, filters=None): ...
```

```ts
// POST /api/admin/data-suite/query
// body: { role, dataset_id, board_id? }
// 401 未登录；403 code=40310 数据权限不足；200 { rows: masked }
```

样例 ACL：`admin` 全量；`analyst`/`guest` 仅 `members` + 样例 board；未知 role → deny。敏感字段仍由既有 masking policy 处理（guest drop phone）。

## Tasks

### Task 1 — Plan + Python ACL + secure path + pytest
- [ ] 本 plan 落盘
- [ ] `acl/{policy,gate,secure}` + fixture YAML
- [ ] `test_query_acl.py`；扩展 `test_dashboard_mask_bind.py`
- [ ] Commit: `feat(data-suite): query ACL gate + forced masking secure path`

### Task 2 — Admin/Portal query API + vitest
- [ ] `data-query-acl.ts` + admin POST route + tests
- [ ] portal 最小 `/api/data-suite/query`
- [ ] Commit: `feat(admin,portal): self-serve query ACL API with forced mask`

### Task 3 — UI copy + e2e + PR
- [ ] data-security「自助取数试探」中文文案 + testids
- [ ] `e2e-data-query-acl.ts`（source `enterprise/.env.local`）；断言 outsider 403 + analyst 脱敏
- [ ] Gates 绿；Mark plan Done；push；`gh pr create`；**不 merge；不启动 H6**

## Done when
1. 越权 role 取数 → `QueryAccessDenied` / HTTP 403
2. 授权受限 role → 返回行已脱敏（phone 非明文）
3. Self-serve API 路径无法跳过 masking（无 raw 敏感字段出口）
4. pytest data_suite（含 ACL + mask bind）绿；vitest query ACL 绿
5. e2e 脚本存在且（admin 可起时）跑通 403 + masked；否则 lib+HTTP handler 测试绿 + 脚本就绪
6. 无客户 IAM / 业务看板 / FinnewsHunter 提交

## Gate before H6
Merge this PR（或用户 stack）后再开 H6 DataFlow 运维面。
