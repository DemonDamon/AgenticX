# SP-C: 沉淀触发 + Case Entry 数据模型

> **批次**: 1（与 SP-A 并行，无依赖）
> **纪律**: 复用 `wiki_compile_queue.py` 与 `brain/wiki/page.py`，不新写编译引擎。case-entry 是纯 Markdown + frontmatter（决策 D1）。

## 目标

1. 定义 case-entry.md 数据模型（frontmatter schema + 正文结构），落盘目录约定 `cases/{org}/{domain}/{slug}.md`（决策 D5，V1 org=default）
2. 沉淀触发：Gate 通过 → 提取阶段产物入 wiki 编译队列（T2）；显式 CLI 命令生成完整 case-entry（T3）
3. lifecycle/scope 字段进 frontmatter（读路径支持，写路径先做最小集）

## 改动点

### 1. 新增 `agenticx/cases/__init__.py` + `agenticx/cases/model.py`

```python
CASE_SCHEMA_VERSION = 1

@dataclass
class CaseEntry:
    case_id: str
    title: str
    type: str = "case"                      # 对齐 wiki 页面类型学，新增 "case"
    summary: str = ""                       # L0：≤256 字符检索摘要
    problem: str = ""                       # L1：问题背景
    solution: str = ""                      # L1：方案概述（含关键决策）
    outcome: str = ""                       # L1：结果（指标 before/after）
    artifacts: list[str] = field(default_factory=list)   # L2：wiki 页面/skills/spec/evals 相对路径
    scope: dict[str, str] = field(default_factory=dict)  # domain/team_size/model_requirement/constraints
    lifecycle_status: str = "active"        # active | superseded | deprecated
    supersedes: list[str] = field(default_factory=list)
    freshness: str = ""                     # ISO 日期，最后更新
    provenance: dict[str, str] = field(default_factory=dict)  # project_ref/trajectory_ref/compiler_version
    verification: dict[str, str] = field(default_factory=dict)  # eval_passed/redline_check/reviewer

def case_frontmatter(entry: CaseEntry) -> str: ...
def render_case_md(entry: CaseEntry) -> str: ...          # frontmatter + L1 正文（## 问题/## 方案/## 结果）
def parse_case_md(path: Path) -> CaseEntry: ...            # frontmatter 解析，容忍未知字段（向后兼容）
```

### 2. 新增 `agenticx/cases/store.py`

```python
class CaseStore:
    def __init__(self, root: Path): ...     # root = <workspace>/cases
    def save(self, entry: CaseEntry) -> Path: ...        # cases/{org}/{domain}/{slug}.md，org 默认 "default"
    def get(self, case_id: str) -> CaseEntry | None: ...
    def list_cases(self, *, domain: str | None = None, org: str = "default") -> list[CaseEntry]: ...
    def build_index(self) -> Path: ...     # cases/index.json（case_id → path/summary/scope，编译期索引，决策 D2）
```

### 3. 沉淀触发：`agenticx/delivery/orchestrator.py` 最小挂点

在 Gate 通过后（stage 状态置 completed 处）追加一个可选回调，**不改核心流程**：

```python
on_stage_passed: Callable[[str, Path, DeliveryPlan], None] | None = None  # orchestrator 构造参数，默认 None
```

新增 `agenticx/cases/precipitate.py`：

```python
def on_stage_passed(stage_id: str, output_dir: Path, plan: DeliveryPlan) -> None:
    """T2: requirements/design 阶段产物 → 追加进 wiki 编译队列（复用 brain/wiki_compile_queue 的入队接口）。
    幂等：以 plan 路径 + stage_id 指纹去重，重复调用不重复入队。"""

def compile_case_entry(plan: DeliveryPlan, *, store: CaseStore, llm=None) -> CaseEntry:
    """T3: 从 plan.mdc（intent/scope/case_link/阶段 summary）+ wiki 页面生成完整 case-entry。
    llm=None 时用规则式汇总（摘要=各阶段 summary 拼接截断）——离线可用，测试不烧钱。"""
```

### 4. CLI 入口：`agenticx/cli/main.py` 追加子命令

```
agenticx case compile --plan <plan.mdc 路径>     # T3：生成 case-entry 落盘
```

注册方式参考该文件既有子命令注册模式。

## 验收（agent 自验，master 复验）

```bash
python -m pytest tests/ -k "case" -x -q
```

新增 `tests/test_case_entry.py`：
- CaseEntry roundtrip（render → parse 相等）；未知 frontmatter 字段不报错
- CaseStore 落盘路径 = `cases/default/{domain}/{slug}.md`；build_index 生成且可重建
- `on_stage_passed` 幂等（同一 stage 二次调用不入队）
- `compile_case_entry` 规则式（llm=None）离线可跑
- CLI `agenticx case compile` 冒烟（tmp 目录）
- 既有 delivery 测试零回归（on_stage_passed 默认 None 不影响）

## 不做

- 不做 T1 会话级自动编译（每轮会话触发——等 T2/T3 稳定后再做，本切片不做）
- 不做 freshness 定时检查（T4）与 evidence 反哺（T5）
- 不做 superseded 状态迁移逻辑（字段先占位）
