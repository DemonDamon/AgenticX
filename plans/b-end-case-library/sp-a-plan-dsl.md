# SP-A: Plan DSL v1 + Gate 结构化契约

> **批次**: 1（与 SP-C 并行）
> **依赖**: 无
> **纪律**: 只改列出的文件。不做大重构。所有新字段可选（向后兼容旧 plan.mdc）。

## 目标

1. `delivery/plan_mdc.py` 的 `DeliveryPlan`/`StageState` 扩展为 LLM 可消费的结构化契约（Plan DSL v1）
2. `delivery/stages.py` 的 `validate_stage_artifacts` 升级为两级验证：文件存在性检查（fast path）+ 可选 LLM 质量门挂载点（结构化输出，不达标必须给可反驳理由）

## 改动点

### 1. `agenticx/delivery/plan_mdc.py`

`StageState` dataclass 新增可选字段（都有默认值，旧文件可读）：

```python
@dataclass
class StageState:
    # ... 现有字段不动 ...
    gate_criteria: list[str] = field(default_factory=list)      # 该阶段 Gate 的验收标准（自然语言，LLM 消费）
    artifact_refs: list[str] = field(default_factory=list)      # 产物相对路径引用（相对 output_dir）
    case_link: str = ""                                          # 该阶段产物沉淀到的 case-entry 路径（SP-C 消费）
```

`DeliveryPlan` 新增：

```python
@dataclass
class DeliveryPlan:
    # ... 现有字段不动 ...
    intent: str = ""                    # 用户原始需求描述（一句话）
    scope: dict[str, str] = field(default_factory=dict)  # 适用条件（domain/team_size/model_requirement）
    case_refs: list[str] = field(default_factory=list)   # 初始化时消费的 case-entry 路径列表（SP-D 消费）
```

`write_plan`/`read_plan`/`update_stage` 同步支持新字段的序列化/反序列化（YAML frontmatter 内）。旧格式文件（无新字段）必须能正常读出，字段取默认值——写一个回归测试用例锁定这一点。

### 2. `agenticx/delivery/stages.py`

新增函数（不改 `materialize_stage_artifacts`——那是 SP-B 的事）：

```python
@dataclass
class GateVerdict:
    passed: bool
    stage_id: str
    fast_path: bool                  # True = 仅文件检查；False = LLM 评审
    failures: list[str]              # 结构化失败理由，每条必须指向具体 gate_criteria
    suggestions: list[str]           # 修复建议（可反驳：说明哪条 spec 没覆盖/哪个用例缺失）

def validate_stage_with_gate(
    stage_id: str,
    output_dir: Path,
    *,
    gate_criteria: list[str] | None = None,
    llm_judge: Callable[[str, list[str], Path], GateVerdict] | None = None,
) -> GateVerdict:
    """两级验证：
    1. fast path: 现有 validate_stage_artifacts 的文件存在性检查，失败直接返回（不调 LLM）
    2. LLM path: gate_criteria 非空且 llm_judge 提供时，调用 llm_judge(stage_id, criteria, output_dir)
    llm_judge 为 None 时退化为纯 fast path（兼容现有调用方与测试）。
    """
```

现有 `validate_stage_artifacts` 保持导出且行为逐字节不变（orchestrator.py L198 和既有测试还在用）。

## 验收（agent 自验，master 复验）

```bash
python -m pytest tests/ -k "plan_mdc or stages or delivery" -x -q   # 既有测试零回归
```

新增测试文件 `tests/test_plan_dsl_v1.py`：
- 旧格式 plan.mdc（无新字段）读出后字段为默认值
- 新字段 roundtrip（write → read 相等）
- `validate_stage_with_gate`：fast path 失败不调 LLM（用假 llm_judge 断言未调用）；fast path 通过 + llm_judge 提供时调用；llm_judge 为 None 时纯 fast path
- `GateVerdict.failures` 每条对应一条 gate_criteria（负例：LLM 返回空 failures 但 passed=False 时应报错或标记）

## 不做

- 不改 `orchestrator.py`（SP-B 接线）
- 不实现具体 LLM judge（SP-B 做接线，本 SP 只定契约）
- 不动 `core/workflow.py`
