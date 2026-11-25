# OKF 消融实验数据集

AgenticX 框架 OKF（Open Knowledge Format v0.2）适配层消融实验的完整数据集。目的：让任何人拿到同一份数据复算实验，验证「OKF 元数据体系相对裸 RAG 的增量价值」这条结论，不需要任何额外数据。

## 目录结构

| 目录 | 规模 | 内容 | 查询标注 |
| --- | --- | --- | --- |
| `bundle_v2_15/` | 15 概念 | 单库 fixture（电商域核心 + 跨域干扰，人工标注） | 12 条（`queries.jsonl`） |
| `scale_60/` | 60 概念 | 生成器造库（8 领域轮转） | 48 条 |
| `scale_200/` | 200 概念 | 同上 | 160 条 |
| `scale_600/` | 600 概念 | 同上 | 480 条 |

每个规模目录就是一个合法的 OKF Bundle：`.md` 概念文件（YAML frontmatter + 正文），`queries.jsonl` 每行是一条标注：`query`（查询）、`relevant`（应命中概念 ID 列表）、`excluded`（陷阱概念 ID 列表，即已过期 `stale_after` 或已废弃 `status=deprecated` 的字面相近概念）。

## 数据口径

- 概念状态分布：六成 `stable`（每十个里有一个带 `verified` human 复核）、一成 `draft`、两成 `deprecated`、一成 `stale_after` 已过期。四个规模构成比例一致，概念序列前缀跨规模相同（seed 固定）。
- 领域：电商 / 金融 / 供应链 / 内容 / 人力 / 医疗 / 法务 / 制造，8 领域轮转。
- 查询密度：每 15 个概念 12 条查询。
- 陷阱设计原则：过期/废弃概念的正文与相关查询保持高字面重叠，使纯语义召回必然命中陷阱——元数据过滤的价值即体现在挡住它们。

## 复算实验

五臂消融（A0 裸 chunk / A1 概念边界 / A2 元数据过滤 / A3 溯源拼装 / A4 信任层级），指标与判定门见 `.cursor/plans/2026-11-25-okf-knowledge-adapter.plan.md`：

```bash
# 用本数据集复算（协作者路径：直接读 datasets/okf_ablation/，跨机器一致）
python3 tests/okf_ablation/run_ablation.py --bundle datasets/okf_ablation/bundle_v2_15
python3 tests/okf_ablation/run_scale_ablation.py --from-datasets

# 不用数据集直接跑（内部自动生成同口径数据，结果一致）
python3 tests/okf_ablation/run_ablation.py
python3 tests/okf_ablation/run_scale_ablation.py

# 常规测试（含判定门与恒定性断言，31 项）
python3 -m pytest tests/okf_reader_test.py tests/okf_export_test.py \
  tests/okf_retrieval_test.py tests/okf_ablation -q
```

重新生成本数据集（结果与提交的版本字节一致）：

```bash
python3 tests/okf_ablation/export_datasets.py
```

## 相关材料

- 消融报告：`.cursor/plans/2026-11-25-okf-ablation-report.md`（单库）与 `.cursor/plans/2026-11-25-okf-scale-ablation-report.md`（规模化）
- 实验驱动：`tests/okf_ablation/run_ablation.py`、`run_scale_ablation.py`
- 适配层实现：`agenticx/knowledge/readers/okf_reader.py`、`agenticx/knowledge/okf_export.py`

## 已知局限（拿去继续实验的方向）

- 打分器是词面重叠（确定性），没有用真实 embedding——换向量后端复测是最直接的增量工作
- LLM-as-judge 盲评与跨模型一致性臂未实现（需要外部模型 API）
- 规模上限 600 概念（纯 Python 打分器的性能边界），量级再往上需要向量库
