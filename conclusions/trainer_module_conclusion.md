# Trainer 模块结论

`agenticx/trainer` 在 commit `22d051f5d18ad83a4c6083683342ab41d7850149`（相对基线 `ca9d92bec05627539228094cacc30dd6d4879f47` 自空包落地）承担 **RSI 数据飞轮的离线蒸馏与回灌骨架**：把已标注的 `RSITrajectory` 变成可外训的 SFT/DPO 资产，并用稳定模型别名把微调结果接回运行时解析；**不在包内启动 GPU 训练、权重更新或 rollout 采集**。

## Responsibility

- **数据集构建**：对轨迹做质量门槛（`quality.py`）、种子化 held-out 隔离（`heldout.py`）、PII/密钥机械脱敏（`scrub.py`），将 pass 轨迹转为 ShareGPT SFT 样本、同任务 pass/fail 转为 DPO 偏好对（`builders.py`），导出 LLaMA-Factory 兼容 `jsonl` 与 `dataset_info.json`，并写数据集 card（`exporters.py`）。
- **模型别名回灌**：`registry.py` 维护别名 → 多版本（candidate / promoted / retired）的 JSON 注册表；`gateway.py` 提供 `resolve_model_alias`（fail-open：含 `/` 的具体模型名、未知别名或注册表异常时原样返回）。
- **CLI 编排**：`__main__.py` 串联 collect → build → registry 子命令，供脚本与验收使用。
- **Explicit non-responsibilities**：不实现 Harbor 内 agent 执行、token 级 rollout 录制、决策头训练或分布式 RL 循环；不替代 `examples/agenticx-for-guiagent/.../trainer/` 等外部示例目录；实际微调仍依赖 LLaMA-Factory 等外部训练器。

## Entry points and public interfaces

| 层级 | 路径 | 作用 |
|------|------|------|
| 包 API | `agenticx/trainer/__init__.py` | 导出 `build_sft` / `build_dpo`；`heldout_split` / `assert_trainable` / `HeldoutViolation` / `TaskSplit`；`export_llama_factory` / `write_card` |
| CLI | `python -m agenticx.trainer` | `collect`（`harbor_collector.collect_jobs` → `TrajectoryStore.append`）；`build --format sft\|dpo`（评分 → 过滤 → 构建 → 导出）；`registry register\|promote\|rollback\|resolve\|list` |
| 运行时解析 | `agenticx/trainer/gateway.py` | `resolve_model_alias(model: str) -> str`，默认读 `~/.agenticx/registry/models.json` |
| 注册表 | `agenticx/trainer/registry.py` | `ModelRegistry(path)`：`register` / `promote` / `rollback` / `resolve` / `list` |

## Core execution path

1. **collect**：`TrajectoryStore`（默认 `datasets/trajectories`）← `collect_jobs(jobs_dir)`，逐条 `append`，stdout 输出 `{"written": n}`。
2. **build**：`store.iter_trajectories()` → `heldout_split(task_ids, seed)` → 每条 `score_trajectory` 写入 `metadata["quality"]` → 按 `min_quality` 过滤 → `build_sft` 或 `build_dpo`（构建前对 held-out `task_id` 调用 `assert_trainable`，违规则 `HeldoutViolation`）→ `export_llama_factory` + `write_card`。
3. **registry / gateway**：别名注册与 promote/rollback 落盘 JSON；推理侧短名经 `resolve_model_alias` 映射到 promoted（或最新 candidate）的 `model` 字段。

## Important classes and functions

- **`heldout_split` / `assert_trainable` / `HeldoutViolation` / `TaskSplit`**（`heldout.py`）：`sha256(task_id|seed)` 确定性 train/heldout 分裂；held-out 任务禁止进入训练样本。
- **`build_sft` / `build_dpo`**（`builders.py`）：消费 `RSITrajectory`，可选 `scrub_trajectory`；DPO 以同任务 pass 终答为 chosen、fail 终答为 rejected。
- **`score_trajectory` / `Quality`**（`quality.py`）：0~1 分与原因清单（缺 user/终答、无验证沿袭、输出长度与 reward 等）。
- **`scrub_text` / `scrub_trajectory`**（`scrub.py`）：正则级脱敏，原地改写 messages 与 tool_calls。
- **`ModelRegistry`**（`registry.py`）：别名版本生命周期与 `resolve` 解析。
- **`resolve_model_alias`**（`gateway.py`）：生产调用侧的 fail-open 别名解析。

## Data and configuration

- **轨迹库**：CLI 默认 `--store datasets/trajectories`，类型与读写由 `agenticx/learning/trajectory/store.py` 的 `TrajectoryStore` 定义。
- **导出产物**：`--out` 目录下 `{name}.jsonl`、`dataset_info.json`、`{name}.card.md`（card 记录 kind、样本数、train 任务集、held-out 列表、seed 等）。
- **模型注册表**：默认 `~/.agenticx/registry/models.json`（CLI `--registry` 与 `gateway.REGISTRY_PATH` 可对齐）。

## Dependencies

- **Upstream**：`agenticx/learning/trajectory/`（`RSITrajectory` 契约、`TrajectoryStore`、`harbor_collector.collect_jobs`）；构建与评分假设轨迹已带 verifier 标注的 `status` / `reward`。
- **Downstream**：`tests/trainer/` 全模块冒烟；`scripts/rsi_smoke.sh` 端到端 build/registry；`agenticx/learning/trajectory/` 与 `agenticx/rl/` 部分路径复用 **`heldout_split` / `HeldoutViolation`** 做任务隔离，但不反向依赖 trainer 的训练逻辑。

## 与 `agenticx/rl` 的边界

| 维度 | `agenticx/trainer` | `agenticx/rl` |
|------|-------------------|---------------|
| 目标 | 离线 **训练数据集** 与 **别名回灌** | 在线/离线 **强化学习与决策监督**（rollout、reward、decision 结构、训练 recipe 等） |
| 输入 | 已落库的 `RSITrajectory` | 环境交互、token rollout、决策日志等 |
| 输出 | ShareGPT/DPO jsonl、dataset card、registry JSON | 策略/决策头相关产物与训练运行时（本结论不展开算法与分布式细节） |
| 重叠点 | 共享 **held-out 任务隔离语义**（trainer 为权威实现）；轨迹字段可与 rollout id 对齐，但 trainer **不读取或更新 RL 权重** |

## 与 `agenticx/learning/trajectory` 的边界

- **trajectory**：采集、存储、TrialForest 回放与 **可执行策略源码** 的 evolve（Dream-RSI 式改进）。
- **trainer**：在轨迹库之上做 **监督/偏好数据集工程** 与 **微调模型别名** 管理；`collect` 子命令复用 trajectory 的 harbor 采集，但 `build` 面向外训工具链而非 `evolve_loop`。

## Tests and operations

- **测试**：`tests/trainer/test_heldout.py`、`test_builders.py`、`test_scrub_quality.py`、`test_exporters.py`、`test_registry.py`、`test_gateway.py`、`test_trainer_cli.py`、`test_registry_cli.py`、`test_acceptance.py`。
- **运维**：`scripts/rsi_smoke.sh` 演示 collect → SFT/DPO build → registry register。
