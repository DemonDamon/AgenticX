# 记忆评测 harness 常设化

Planned-with: Claude Opus 5
Suggested-Impl-Model: Composer 2.5 档（纯脚本改造，不触碰生产代码）
Plan-Id: 2026-09-14-near-memory-01-eval-harness
Parent-Plan: `.cursor/plans/pending/2026-09-14-near-memory-recall-overhaul-master.plan.md`
Status: draft

---

## 0. 给实施者的阅读须知

- 本计划**只改 `research/memory-eval/` 下的脚本**，不碰 `agenticx/` 任何生产代码，不碰 Desktop。
- 行号为 2026-09-14 快照，若偏移请用函数名锚点定位，不要猜。
- 严守 `no-scope-creep`：不顺手重构 `run_poc.py` 里与本计划无关的评分逻辑。
- Python 遵守 google 风格：英文 docstring、文件头 `Author: Damon Li`、禁相对 import、代码内无 emoji。

---

## 1. 为什么要先做这件事

主计划的 02（召回修复）需要一个能反复跑、结果可比的回归基线。现有脚本是一次性 PoC，有三个问题让它无法承担这个角色：

1. **抽样依赖数据集内容**。`run_poc.py::sample_oracle`（L292）在运行时按 `SEED=20260914` + `TYPE_QUOTA`（L44）现场分层抽样。数据集文件若被重新下载或版本变动，抽到的 20 题会漂移，改动前后的数字就不可比。
2. **补跑会卡死**。`run_glm_reader.py::retry_errors`（L330）对每个待补题调用 `collect_contexts`（L192），而后者内部调 `poc.run_longmem_item` 完整重建一遍索引与归档，再重算四套上下文。2026-09-14 实测该路径在第一题上超过 6 分钟无输出，最终被人工终止。
3. **没有结果对比**。两次运行只能靠人眼比对两份 `REPORT.md`。

另外数据集放在 `/tmp/longmemeval-cleaned/`，重启后会丢，脚本目前直接报错退出，没有可读的指引。

---

## 2. In scope / Out of scope

### In scope

- 固化评测样本 id 清单到仓库。
- 拆分「词面模式」与「LLM 读者模式」，前者可独立跑、无需任何 API key。
- 修复补跑卡死：上下文缓存 + 阶段计时。
- 两次结果的机器可读 diff。
- 数据集缺失时给出可执行的获取指引而非裸异常。

### Out of scope

- 改动任何评分口径（`score_context` L317 的判定规则保持原样）。
- 新增题目或扩大样本量（20 + 10 维持不变）。
- 接入 CI（本地可跑即可，CI 另议）。
- 改 `agenticx/` 下任何文件。
- 把数据集提交进仓库（体积 15MB / 265MB，仍然不入库）。

---

## 3. 需求

### FR-1：样本清单固化

新增 `research/memory-eval/sample_ids.json`，内容为当前 seed 抽出的 20 个 `question_id`，按现有顺序，附 `question_type`：

```json
{
  "source": "longmemeval-cleaned oracle",
  "seed": 20260914,
  "generated_at": "2026-09-14",
  "ids": [
    {"question_id": "gpt4_2312f94c", "question_type": "temporal-reasoning"},
    {"question_id": "gpt4_af6db32f", "question_type": "temporal-reasoning"}
  ]
}
```

完整 20 项按 `results/2026-09-14-glm-reader/REPORT.md` 的「逐题」表顺序生成，不要重新抽样。

`run_poc.py::sample_oracle`（L292）改为：

- 若 `sample_ids.json` 存在，按其中 `ids` 顺序从数据集取题；任一 id 在数据集中缺失则**报错退出**并列出缺失 id（不允许静默跳过，那会让分母变化）。
- 若不存在，回退当前的分层随机抽样，并把结果写出一份 `sample_ids.json` 供后续固化。

### FR-2：词面模式与 LLM 模式分离

`run_poc.py` 已经是纯词面、不调 LLM，保持不变。需要补的是 CLI 契约：

- `run_poc.py` 新增 `--out <dir>` 参数，默认仍为 `results/2026-09-14-poc`。回归时用 `--out results/<date>-<label>` 避免覆盖历史基线。
- `run_glm_reader.py` 同样新增 `--out <dir>`。
- 两个脚本在启动时打印一行 `sample: N ids from sample_ids.json`（或 `sampled fresh`），让运行者确认跑的是同一批题。

### FR-3：补跑不再卡死

改 `run_glm_reader.py`：

- `collect_contexts`（L192）的结果按 `question_id` 缓存到 `<out>/contexts/<question_id>.json`（键为四个基线名 + `meta`）。存在且非空时直接读盘，不重建索引。
- `retry_errors`（L330）优先走缓存；缓存缺失才重建。
- `collect_contexts` 与每次 LLM 调用前后打点，输出形如 `ctx gpt4_d31cdae3 took 8.4s` / `call oracle_evidence took 21.1s`，让卡点可见。
- 上下文缓存目录写入 `.gitignore`（`research/memory-eval/results/*/contexts/`），不入库。

已知事实：`GLM_READER_CTX_CAP`（L120，默认 6000）已对读者上下文做截断；`GLM_TIMEOUT_S` / `GLM_RETRIES` 已可配。本计划不改这些默认值。

### FR-4：结果 diff

新增 `research/memory-eval/compare_runs.py`：

```
python3 research/memory-eval/compare_runs.py <baseline_dir> <candidate_dir>
```

- 读两侧 `results.json`，按基线名输出正确率变化，按 `question_id` 输出翻转项（`no → yes` / `yes → no`）。
- 同时支持词面结果（`run_poc.py` 产物）与 LLM 结果（`run_glm_reader.py` 产物），靠 JSON 里的字段判别，找不到已知结构时报错退出。
- 输出 Markdown 到 stdout，调用者自行重定向。

### FR-5：数据集缺失的可读提示

`run_poc.py` 顶部 `ORACLE_PATH`（L35）/ `S_PATH`（L36）不存在时，打印获取方式后以非零码退出：

```
missing dataset: /tmp/longmemeval-cleaned/longmemeval_oracle.json
get it from https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
(hf-mirror works when the direct host is unreachable)
```

不要尝试自动下载。

### NFR-1：隔离不得退化

`isolate_home`（L103）当前把 `HOME`、`USERPROFILE`、`AGENTICX_WORKSPACE_DIR`、`AGX_WORKSPACE_ROOT` 指向临时目录。改造后必须保留，并在 `main()` 入口加一条断言：解析出的 workspace 根路径不得位于真实 `~/.agenticx` 下，否则立刻退出。

---

## 4. 验收标准

- **AC-1**：删除 `sample_ids.json` 后跑 `run_poc.py`，会生成该文件；再次运行，抽到的 20 个 id 与文件一致。
- **AC-2**：手动从 `sample_ids.json` 删掉一个 id 的对应题目（用一份裁剪过的数据集副本），运行报错并列出缺失 id，退出码非零。
- **AC-3**：`run_poc.py --out results/tmp-check` 跑通，产出 `REPORT.md` 与 `results.json`，四基线数字与 `results/2026-09-14-poc/REPORT.md` 逐项一致（证明改造没动评分口径）。
- **AC-4**：`run_glm_reader.py` 跑过一次后，`<out>/contexts/` 下有 20 个 JSON；再跑 `--retry-errors`，日志中出现 `ctx ... cached`，且单个待补 cell 从开始到出结果不超过 90 秒。
- **AC-5**：`compare_runs.py results/2026-09-14-poc results/tmp-check` 输出全 0 变化。
- **AC-6**：`isolate_home` 断言生效——临时注释掉环境变量设置后运行，脚本立即退出且不在真实 `~/.agenticx` 下产生任何文件。

---

## 5. 交付物

- `research/memory-eval/sample_ids.json`（新建，入库）
- `research/memory-eval/run_poc.py`（改：FR-1、FR-2、FR-5、NFR-1）
- `research/memory-eval/run_glm_reader.py`（改：FR-2、FR-3）
- `research/memory-eval/compare_runs.py`（新建）
- `research/memory-eval/README.md`（补：回归用法、diff 用法、数据集获取）
- `.gitignore`（补一行 contexts 缓存）

---

## 6. 禁止事项

- 不改 `score_context`、`summarize_longmem`、`render_report` 的判定与统计口径。
- 不改 `near_cases.json` 的 10 条用例内容。
- 不覆盖 `results/2026-09-14-poc/` 与 `results/2026-09-14-glm-reader/`，它们是历史基线。
- 不把 API key 写入任何仓库文件；凭证只走环境变量或本机 `~/.agenticx/config.yaml`。
- 不改 `agenticx/` 下任何文件。
