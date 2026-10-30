# AGX Data Suite H8 — 圈选 DSL 真通道下推

> **Parent:** `.cursor/plans/pending/2026-10-30-data-suite-p3-harden.plan.md` §H8  
> **Branch:** `feat/agx-data-suite-h8-audience-pushdown`  
> **Depends on:** H7 merged (`784ba872` / PR #174).  
> **Main-repo gate:** 通道向编译器 + 假标签列名；禁止行业人群包 / 标签字典内容 / `delivery_pack` 进 `agenticx/`。

**Goal:** 将 audience DSL 从纯内存 `select_audience` 扩展为可编译到 ClickHouse / JDBC(sqlite) 原生谓词并经通道 `query` 下推执行；结果集在绑定 policy 时强制过 `MaskingEngine`；DSL 语义与内存路径向后兼容。

**Architecture:** 新增 `audience/pushdown.py`：AST → dialect SQL（`compile_audience_sql`）→ `DataChannel.query` 执行（`pushdown_select`）→ 可选 masking。不改 `select_audience` 行为。无 live ClickHouse 时以 CH SQL 编译断言 + sqlite JDBC 真执行 + 1e5 行基准验收。

**Tech Stack:** Python 3.10+、JdbcChannel(sqlite)、ClickHouse SQL 方言字符串、MaskingEngine、pytest。

## Global Constraints

- 假数据 / 假标签列名 only（如 `tag_status_active`、`tag_premium`、`channel`）。
- 编译器面向通道方言，不面向某客户 schema。
- Admin UI **非必须**；pytest 为主门禁。
- 不启动 H10/H9；不 merge；不动 FinnewsHunter。

## Inventory（H8 前 @ `784ba872`）

| 面 | 状态 |
|----|------|
| `audience/dsl.py` `select_audience` | 仅内存 and/or/not + eq/in/exists |
| `tests/data_suite/test_audience_dsl.py` | 绿；无 pushdown |
| `channels/{clickhouse,jdbc,fake}.py` | 有 `query`；Fake 仅 `SELECT * FROM t` |
| `masking/` + `acl/secure_*` | H5 已合入；pushdown 结果应复用 MaskingEngine |
| `test_audience_pushdown.py` | **缺口** |
| 量级基准 1e5 | **缺口** |
| 行业人群包 / 标签字典 | 非目标（不进本 PR） |

## File map

| Path | Responsibility |
|------|----------------|
| `agenticx/data_suite/audience/pushdown.py` | `compile_audience_sql` + `AudiencePushdownResult` + `pushdown_select` |
| `agenticx/data_suite/audience/__init__.py` | 导出 pushdown 符号 |
| `agenticx/data_suite/audience/dsl.py` | **不改语义**（仅必要时加注释） |
| `tests/data_suite/test_audience_pushdown.py` | 编译断言、sqlite 下推、与内存语义对拍、masking、1e5 bench |
| `tests/data_suite/test_audience_dsl.py` | 保持绿（回归） |
| `.cursor/plans/pending/2026-10-30-agx-data-suite-h8-audience-pushdown.plan.md` | 本 plan |

## Interfaces

```python
# agenticx.data_suite.audience.pushdown

def compile_audience_sql(
    query: Dict[str, Any],
    *,
    table: str,
    id_field: str = "member_id",
    dialect: str = "sqlite",          # "sqlite" | "jdbc" | "clickhouse"
    columns: List[str] | None = None, # default [id_field]
) -> str:
    """Compile audience AST → read-only SELECT ... WHERE ..."""

@dataclass
class AudiencePushdownResult:
    ids: List[str]
    rows: List[Dict[str, Any]]
    sql: str
    dialect: str

def pushdown_select(
    channel: Any,                     # DataChannel with .query
    query: Dict[str, Any],
    *,
    table: str,
    id_field: str = "member_id",
    dialect: str | None = None,       # infer from channel if None
    columns: List[str] | None = None,
    limit: int = 100_000,
    masking: MaskingEngine | MaskingPolicy | None = None,
    role: str | None = None,
) -> AudiencePushdownResult:
    """Compile + channel.query; force masking when policy/engine bound."""
```

**SQL 语义对齐 `select_audience`：**
- `and` / `or` / `not` 嵌套
- `eq` → `col = lit`；`in` → `col IN (...)`；`exists` → `col IS NOT NULL AND col != ''`
- 标识符：仅允许 `[A-Za-z_][A-Za-z0-9_]*`（非法即 ValueError）
- bool 字面量：sqlite/jdbc → `1`/`0`；clickhouse → `true`/`false`

## Tasks

### Task 1 — Plan + compiler + pushdown + pytest

- [x] 本 plan 落盘
- [x] `pushdown.py` + `__init__` 导出
- [x] `test_audience_pushdown.py`：
  - CH + sqlite 编译快照（同 fixture query）
  - sqlite JDBC 下推与 `select_audience` id 集合一致
  - masking：policy 绑定后 phone/email 被脱敏；未绑定时原样
  - bench：1e5 行假数据，断言命中数 + 耗时宽松上界（如 < 15s）
- [x] `test_audience_dsl.py` 仍绿
- [x] Commit: `feat(data-suite): H8 audience DSL pushdown to JDBC/CH`

### Task 2 — PR（不 merge）

- [x] Mark plan Done；push；`gh pr create` 含 gates 表 + pytest checkbox
- [x] **不 merge；不启动 H10/H9**

## Done when

1. `compile_audience_sql` 对 clickhouse 与 sqlite/jdbc 产出合法 WHERE
2. `pushdown_select` 经 JdbcChannel(sqlite) 真执行，ids 与内存 `select_audience` 一致
3. 绑定 MaskingPolicy 时结果行强制脱敏
4. `tests/data_suite/test_audience_pushdown.py` + `test_audience_dsl.py` 绿；含 1e5 bench
5. 无行业包、无 delivery_pack、无 FinnewsHunter、无 H10/H9、无 merge

## Gate before H10

Merge this PR（或用户 stack）后再开 H10 golden-path 通道场景扩展。
