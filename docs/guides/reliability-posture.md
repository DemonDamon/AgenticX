# 可靠性姿态（reliability.posture）

AgenticX 用 `reliability.posture` 决定磁盘写失败时是中止本轮，还是记日志后带病继续。

## 两种姿态

| | `strict`（默认） | `legacy` |
|---|---|---|
| 持久化失败 | 中止本轮，错误对调用方可见 | 记日志，运行继续 |
| `persist_fail_closed_enabled()` | 默认 True | 默认 False |
| `CheckpointStore.save` | 返回 `False` 并累计 `save_failures`；首次失败打 error 日志 | 同样可观测，但不因此改变主循环默认 |
| 适用 | 新部署、关心重复副作用 | 需要与 2026-09 之前行为对齐的回滚 |

`strict` 下 `CheckpointStore.save` **仍然不抛异常**。它是 best-effort 补充检查点，主持久化门禁仍是 `_persist_or_abort()`。

## Subplan 04 对照数字

用 `agenticx-reliability-v1` 在同一机器上各跑一遍。该基准驱动的是 SDK `ReActAgent` + `RunStateStore`，不经过 `CheckpointStore` / `_persist_or_abort`，所以两姿态数字相同。放行条件全部满足，因此默认切到 `strict`。

| 指标 | `legacy` | `strict` | 方向 |
|---|---|---|---|
| duplicate_side_effect_rate | 0.0000 | 0.0000 | 越低越好 |
| crash_recovery_success_rate | 1.0000 | 1.0000 | 越高越好 |
| history_consistency_rate | 1.0000 | 1.0000 | 硬要求 1.0 |
| error_diagnosability_rate | 1.0000 | 1.0000 | 越高越好 |

复现命令：

```bash
python -c "
from pathlib import Path
from agenticx.evaluation import EvalSet, ReliabilityRunner
es = EvalSet.from_file('agenticx/evaluation/benchmarks/reliability_v1.json')
import tempfile
with tempfile.TemporaryDirectory() as d:
    print(ReliabilityRunner(root=Path(d)).run(es).to_report())
"
```

## 回滚

整体退回旧姿态：

```bash
export AGX_RELIABILITY_POSTURE=legacy
```

或在 `~/.agenticx/config.yaml`：

```yaml
reliability:
  posture: legacy
```

只回滚「持久化失败是否中止本轮」这一项：

```bash
export AGX_PERSIST_FAIL_CLOSED=0
```

优先级：`AGX_PERSIST_FAIL_CLOSED` > `runtime.persist_fail_closed` > `AGX_RELIABILITY_POSTURE` > `reliability.posture` > `strict`。拼写错误的 posture 回落到 `strict`，不会悄悄变成 `legacy`。

## 方法论限制

本对照用的是**进程内模拟崩溃**（在指定边界抛不可捕获异常并丢弃内存态，从磁盘状态重建），不是真实进程 kill，也不覆盖 OS 级页缓存丢失、磁盘损坏等物理故障。

## 验证记录

- `pytest tests/test_reliability_posture.py tests/test_smoke_persist_fail_closed.py`：15 passed。
- `agx serve --host 127.0.0.1 --port 18801` 冷启动后，`curl --noproxy '*'` 打 `/api/session`、`/api/avatars`、`/api/sessions` 均返回 200。
- Desktop 人工 3 轮对话：本阶段未启动 Near GUI。`strict` 在磁盘健康时应完全不可感知；若分身/历史/工作区同时空态，优先查 `agx serve` 是否存活。
