# SP26 决策头基线：scorer 库化 + 本地服务化 + test 划分评测

> Master plan: [MASTER-PLAN.md](MASTER-PLAN.md)（核心价值 V1 风险对冲 + V2 数据变现）
> 前置：SP25（`agenticx/rl/decision.py` schema、`decision_mining.py` 挖掘已合入）

## 背景

SP25 落了决策点标注层但没有消费侧：`scripts/backfill_decisions.py` 里躺着一个
"openai 兼容受限 softmax 标注机"（max_tokens=1 + top_logprobs，候选符号上映射
logprobs 再归一）和一个 mock scorer，但它们锁在脚本里，无法被评测/回放/gating
复用。同时 SP25 攒下的 decisions.jsonl 还没有一次像样的基线评测——"StartLux-Decision
零样本在我们的 state/候选集分布上到底行不行"没有数字。

本 SP 做三件事：把 scorer 提为库、搭评测 harness、打通本地服务化路径。

## 任务

### T1 scorer 库化
- [ ] 新建 `agenticx/rl/decision_scorers.py`：
  - `make_scorer(name, **cfg)` 工厂，name ∈ {`mock`, `openai`, `startlux`}
  - `mock_scorer`：从 backfill_decisions.py 原样迁移（sha256 确定性）
  - `OpenAICompatScorer`：受限 softmax 标注机迁移 + prompt 模板参数化
    （默认模板与现状逐字节一致，防数据集漂移）；`_LETTERS` 字母位映射保持
  - `startlux` = openai 的配置档：默认 base_url/model 指向本地 llama.cpp/ollama
    服务（ GGUF 部署 StartLux-Decision-4B），仅是预设值不含新逻辑
- [ ] `scripts/backfill_decisions.py` 改薄壳调库，行为与 CLI 参数不变

### T2 评测 harness
- [ ] 新建 `agenticx/rl/decision_eval.py`（库，可测）：
  - `top1_accuracy(records)`：argmax(probs) vs `label_for(qid).hard`（execution 真值）
  - `expected_calibration_error(records, n_bins=15)`：等频分桶 ECE
  - `fit_temperature(calib_records)`：单参数温度缩放（NLL 网格/黄金分割），
    只在 calib 划分拟合，不改变 argmax
  - `eval_split(records)`：分 decision_type × question 汇总，输出 dict 报告
- [ ] 新建 `scripts/eval_decision_baseline.py`（CLI）：
  - `--data`（decisions.jsonl 或目录，目录则合并 rounds；也接受 `.labeled.jsonl`）
  - 纪律强制：无 split 的数据要求 `--assign-split` 显式确认；只评 test 划分；
    calib 拟温度后 test 只读一次
  - `--scorer mock|openai|startlux`（现场打分）或直接用已补标文件的 teacher probs
  - `--limit`；报告落 `results/decision-layer/baseline/`（json + md）
- [ ] 测试夹具：合成轨迹 → `mine_tool_decisions` → 指定标注 → 三分，全链路纯内存

### T3 本地服务化路径（真实模型）
- [ ] `scripts/serve_decision_model.sh`：HF 下载 GGUF（0.8B 冒烟 + 4B Q8/Q4）+
  llama.cpp `llama-server` 启动 + logprobs 可用性一步验证（curl top_logprobs）
- [ ] 环境验证：网络可达则真实跑一轮 0.8B/4B 基线并落盘；不可达则报告标记
  `degraded: model-unavailable`，endpoint 路径留配置

## 做成什么样

- 库 + CLI + 脚本三件套，`pytest tests/rl/test_decision_scorers.py
  tests/rl/test_decision_eval.py` 全绿（mock 无网可跑）
- 一份基线报告（真实或 degraded），含：分决策类型 n / top-1 acc / ECE /
  温度校准前后对比 / scorer 与环境元信息
- 现有 `tests/rl/test_decision.py` 回归不破

## 验收

- [ ] mock 全链路冒烟：合成→切分→calib 拟温→test 评测→报告落盘，一条命令可重跑
- [ ] openai scorer 用 fake client 单测：prompt 构造、logprobs→probs 映射、
  未命中候选 -30 兜底、probs 长度与 symbols 对齐
- [ ] 温度拟合数值正确性：手工构造可解析的夹具验证（如两样本 probs+hard
  label 的闭式解邻域）
- [ ] test 只读一次：harness 内部断言 eval 只发生在 test 切分
- [ ] （若可得）真实基线数字落盘并在 master plan 状态表登记

## 明确不做

- 不评 train/calib 切分的 acc 作为结论（只作 sanity 对照）
- 不做多模型矩阵横评（0.8B/4B 二选一先行，9B/27B 不碰）
- 不做批量补标（SP28 的事，本 SP 只评不写回）
