# SP-B: Delivery 阶段 Agent 化（requirements/design 先行）

> **批次**: 2（依赖 SP-A 的 GateVerdict/gate_criteria 契约）
> **纪律**: 只改 orchestrator.py / stages.py 及新增文件。LLM 调用必须有 dry-run/离线 fallback（测试不烧钱）。testing/audit 阶段保持现状（切片范围外）。

## 目标

1. `requirements` 和 `design` 两个阶段的 `materialize_stage_artifacts` 从写死的 stub 换成 LLM 真实生成（产物质量对得起 Gate 评审）
2. `orchestrator.py` 的 Gate 调用点（L198）接上 SP-A 的 `validate_stage_with_gate`，LLM 质量门真实生效：不达标给出结构化理由并退回
3. LLM 不可用时优雅降级到现有 stub（dry_run 模式和测试不受影响）

## 改动点

### 1. 新增 `agenticx/delivery/stage_agents.py`

```python
@dataclass
class StageAgentResult:
    artifacts: list[str]        # 写出的产物相对路径
    summary: str                # 本阶段做了什么（进 case-entry 的 outcome 用，SP-C 消费）

class StageAgent(Protocol):
    def run(self, *, intent: str, input_files: list[str], output_dir: Path) -> StageAgentResult: ...

class RequirementsAgent:  # 生成 requirement-breakdown.md（结构化：目标/验收标准/边界/风险）
class DesignAgent:        # 生成 design/design-system.md（基于 requirements 产物，引用其验收标准）

def make_stage_agent(stage_id: str, *, llm_factory: Callable[[], Any] | None) -> StageAgent | None:
    """llm_factory 为 None 时返回 None → 调用方降级到 stub。"""

# LLM 质量门实现（满足 SP-A 的 llm_judge 签名）
def llm_gate_judge(stage_id: str, gate_criteria: list[str], output_dir: Path) -> GateVerdict:
    """读产物全文 + criteria → 单次 LLM 调用 → 要求 JSON 输出 {passed, failures[{criterion, reason}], suggestions[]}
    输出解析失败 → passed=False, failures=["gate output unparseable"]（fail-closed，不静默放行）"""
```

LLM 调用方式参考 `brain/wiki_compiler.py` 的 `_invoke_llm`（L141）——直接复用或 import，不要另起炉灶。

### 2. `agenticx/delivery/stages.py`

`materialize_stage_artifacts` 增加可选参数：

```python
def materialize_stage_artifacts(
    stage_id: str, *,
    output_dir, worktree_path, project_name, input_files,
    dry_run: bool = True,
    stage_agent: StageAgent | None = None,   # 新增
) -> list[str]:
    """requirements/design 且 stage_agent 提供时走 StageAgent；
    其余情况走现有模板逻辑（逐字节不变）。"""
```

### 3. `agenticx/delivery/orchestrator.py`

- L190 `materialize_stage_artifacts` 调用点：传入 `stage_agent=make_stage_agent(stage_id, llm_factory=...)`（从 config/llms 取，取不到传 None）
- L198 `validate_stage_artifacts` 调用点：替换为 `validate_stage_with_gate(stage_id, output_dir, gate_criteria=stage.gate_criteria, llm_judge=llm_gate_judge if stage_agent_used else None)`
- Gate 不通过时的退回逻辑：复用现有 retry 机制（`max_stage_retries`），把 `GateVerdict.failures` 写进 stage 的 blocker 字段

## 验收（agent 自验，master 复验）

```bash
python -m pytest tests/ -k "delivery or orchestrator or stage_agent" -x -q
```

新增 `tests/test_stage_agents.py`（全部离线，用 fake llm）：
- RequirementsAgent 生成产物包含"验收标准"结构
- StageAgent 为 None → orchestrator 行为与现在完全一致（回归锁定）
- Gate 失败 → blocker 含结构化 failures，触发 retry
- llm_gate_judge 输出解析失败 → fail-closed
- dry_run=True 不调 LLM

## 不做

- development/testing/audit 阶段的 Agent 化（切片外，stub 保留）
- 不做 Plan 动态重规划（那是后续）
- 不做 Gate-人工一致性校准数据集（先跑通机制，校准是运营期工作）
