# AGX Data Suite H7 — ID-Mapping 管理台

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md`  
> **Branch:** `feat/agx-data-suite-h7-idmapping-admin`  
> **Depends on:** H6 merged (`79d7907d` / PR #173); **engine/profile/store + `test_idmapping_engine.py` 已合入 — DO NOT redo。**  
> **Main-repo gate:** 通用可配 ID 类型积木；样例只用脱敏假数据（phone/email/member_id）；禁止客户 ID 体系 / B4 / delivery_pack 进 `agenticx/`。

**Goal:** 打通「profile 配置 → 关联合并 → 冲突人工裁决 → 快照对比」运营面：
1. 稳定 profile API（CRUD / 加载 YAML 或 JSON，≥2 种可配 ID 类型）
2. 冲突审阅队列：merge 产出 conflicts → 列表 → 人工裁决并持久化
3. 快照对比视图：SnapshotStore 两快照 diff / 并排
4. Admin「ID 映射」中文运维页 + `/api/admin/data-suite/idmapping/...`
5. pytest `test_idmapping_admin.py`：两种假 ID 类型关联合并 + 冲突裁决；Playwright e2e

**Inventory（H7 前）**

| 面 | 状态 |
|----|------|
| `idmapping/{engine,profile,store}.py` | 已有；merge 返回 conflicts；SnapshotStore 内存/目录；**无** list/compare、**无** 裁决持久化 |
| `tests/data_suite/test_idmapping_engine.py` + `fixtures/idmap_profile.yaml` | 已有引擎级；**无** admin/裁决 |
| Admin data-suite idmapping API/UI | **缺口** |
| H3 governance / H6 data-jobs admin | 可复用 store+route+section 模式 |
| 业务 ID / B4 / delivery_pack | **非目标** |

**Out of scope:** H8 圈选 DSL；业务 ID 体系；重做 engine 合并算法；FinnewsHunter；合并本 PR。

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/idmapping/profile.py` | `load_profile_dict` / `profile_to_dict` / `dump_profile`（YAML+JSON） |
| `agenticx/data_suite/idmapping/store.py` | `list_ids`；可选目录枚举 |
| `agenticx/data_suite/idmapping/admin.py` | `IdMappingAdminService`：profile CRUD、merge→冲突入队、resolve、compare_snapshots |
| `agenticx/data_suite/idmapping/__init__.py` | 导出 admin / dump 符号 |
| `tests/data_suite/test_idmapping_admin.py` | 两种假 ID + 关联合并 + 冲突裁决 + 快照对比 |
| `enterprise/.../lib/idmapping-store.ts` | Admin 持久化 profiles/conflicts/snapshots |
| `enterprise/.../lib/__tests__/idmapping-store.test.ts` | store vitest |
| `enterprise/.../api/admin/data-suite/idmapping/profiles/route.ts` | GET/POST profile |
| `enterprise/.../api/admin/data-suite/idmapping/merge/route.ts` | POST 关联合并 |
| `enterprise/.../api/admin/data-suite/idmapping/conflicts/route.ts` | GET 队列；POST 裁决 |
| `enterprise/.../api/admin/data-suite/idmapping/snapshots/route.ts` | GET list/compare |
| `enterprise/.../api/**/__tests__/` | 路由级 vitest（至少 conflicts + profiles） |
| `enterprise/.../_sections/data-idmapping.tsx` | 「ID 映射」中文 UI：profile / 冲突 / 快照对比 |
| `enterprise/scripts/e2e-data-idmapping.ts` | Playwright：配置→合并→裁决 |
| `messages/zh.json` (+ en 镜像键) | 导航 + 页文案，UI 无中英混排 |
| AppShell / platform-sections / [section]/page / nav test | 注册 `data-idmapping` |

## Interfaces

```python
# agenticx.data_suite.idmapping.admin
@dataclass
class ConflictRecord:
    id: str
    snapshot_id: str
    profile_name: str
    id_type: str
    values: list
    rows: list
    status: Literal["open", "resolved"] = "open"
    decision: Literal["keep_value", "reject_merge"] | None = None
    chosen_value: Any | None = None
    note: str | None = None
    resolved_at: str | None = None

@dataclass
class SnapshotDiff:
    left_id: str
    right_id: str
    only_left_subject_ids: list[str]
    only_right_subject_ids: list[str]
    shared_subject_link_changes: list[dict]
    left_conflicts: int
    right_conflicts: int

class IdMappingAdminService:
    def save_profile(self, profile: IdMapProfile | dict, *, fmt: str = "yaml") -> IdMapProfile: ...
    def list_profiles(self) -> list[str]: ...
    def get_profile(self, name: str) -> IdMapProfile: ...
    def merge(self, profile_name: str, records: list[dict], *, as_of: str | None = None) -> MergeResult: ...
    def list_conflicts(self, *, status: str | None = None) -> list[ConflictRecord]: ...
    def resolve_conflict(self, conflict_id: str, *, decision: str, chosen_value=None, note=None) -> ConflictRecord: ...
    def compare_snapshots(self, left_id: str, right_id: str) -> SnapshotDiff: ...
    def list_snapshots(self) -> list[str]: ...
```

```ts
// GET  /api/admin/data-suite/idmapping/profiles     → { profiles }
// POST /api/admin/data-suite/idmapping/profiles     body: profile dict | { ensure_sample: true }
// POST /api/admin/data-suite/idmapping/merge        body: { profile_name, records }
// GET  /api/admin/data-suite/idmapping/conflicts    → { conflicts }
// POST /api/admin/data-suite/idmapping/conflicts    body: { conflict_id, decision, chosen_value?, note? }
// GET  /api/admin/data-suite/idmapping/snapshots    → { snapshot_ids } | ?left=&right= → { diff, left, right }
// 401 未登录；样例 ID 类型：phone / email（脱敏假数据）
```

样例 profile：`demo_fake_ids`，`id_types: [phone, email]`，`merge.priority: [email, phone]`，`on_conflict: prefer_priority`。

## Tasks

### Task 1 — Plan + Python admin + pytest
- [x] 本 plan 落盘
- [x] profile dump/dict；store.list_ids；admin.py
- [x] `test_idmapping_admin.py`
- [x] Commit: `feat(data-suite): ID-Mapping admin profile/conflict/snapshot API`

### Task 2 — Admin store/API + vitest + UI
- [x] `idmapping-store.ts` + routes + tests
- [x] `data-idmapping.tsx` 中文页 + nav/messages/platform-sections
- [x] Commit: `feat(admin): data-suite idmapping 管理台`

### Task 3 — e2e + PR
- [x] `e2e-data-idmapping.ts`（source `enterprise/.env.local`）；可选 shot
- [x] Gates 绿；Mark plan Done；push；`gh pr create`；**不 merge；不启动 H8**

## Done when
1. profile API 可配置 ≥2 假 ID 类型（YAML/JSON）
2. merge 冲突入审阅队列；人工 keep_value / reject_merge 持久化
3. 两快照可对比（subject/link/conflict 差）
4. pytest admin 绿；admin vitest 绿
5. e2e（admin 可起时）配置→合并→裁决；否则 store+route 绿 + 脚本就绪
6. 无业务 ID / B4 / delivery_pack / FinnewsHunter；不启动 H8；不 merge

## Gate before H8
Merge this PR（或用户 stack）后再开 H8 圈选 DSL 真通道下推。
