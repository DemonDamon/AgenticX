# OKF 知识格式适配层

AgenticX 对 [Open Knowledge Format (OKF)](https://open-knowledge-format.org/)（Google 发起的开放知识格式，v0.2）的读写适配：外部 OKF Bundle 可读入知识库，知识库可导出为 OKF Bundle 分发。本文说明能力边界、实验验证与复算方式。

## 为什么做

RAG 的一个实际缺陷：知识库里的过期/废弃知识会被检索捞出来，模型不知道它们过期，照着答就错。OKF 给每个知识（Markdown 文件）加了一段机器可读的元数据（frontmatter：status / stale_after / verified / sources），使"过期"成为可判定的事实而不是模型要猜的事。AgenticX 的 Knowledge/Memory 体系缺一个**可 git、可 diff、跨组织交换**的知识层，OKF 填这个位置。

## 能力

读：`Knowledge.add_from_path(path, reader_name='okf')`，支持 Bundle 目录树与单文件；frontmatter 完整存于 `custom["okf"]`（未知字段不丢失，round-trip 保真）；`title→name`、`tags→tags`、`resource→source` 提升到顶级 metadata，检索过滤可直接用。坏 YAML 宽忍降级为正文，不中断导入。

写：`okf_export(documents, bundle_root)`，导出为 Bundle 目录树，导出动作记 `process:agenticx-export` 溯源，含路径穿越防护与概念去重。

设计边界：`.md` 默认仍走 text reader，OKF 需显式指定；`content_type` 的 MIME 语义不动，OKF `type` 走 custom 通道——避免普通 Markdown 目录误判。

## 实验验证（消融）

数据集随仓库分发：`datasets/okf_ablation/`（15/60/200/600 四个规模共 875 个概念文件 + 查询标注），全部确定性可复算。图文版讲解决明见飞书文档《[OKF 知识格式接入 AgenticX：三个实验的完整记录](https://wv18cbjmgi0.feishu.cn/docx/L80TdLnTuodzJexHC4VcHaLonBh)》（内嵌四分区图解画板，SVG 源在 `diagrams/2026-11-25T181901/`）。

确定成立的结论：

| 结论 | 数据 |
| --- | --- |
| 过期/废弃知识混入从 100% 降到 0% | 元数据过滤，四个规模全为 0，且不误伤正确知识 |
| 上下文长度省 58%~65% | 15 概念：501→208 字/次；大规模稳定在 1/3 强 |
| 库越大，知识单元粒度检索的排名优势越大 | 600 概念 MRR：切碎 0.382 vs 概念粒度 0.531 |

不成立/修正的结论：verified 作为排序主导键会把 MRR 从 0.823 压到 0.415（正确语义是轻加权）；跨模型一致率受模型采样噪声影响不作依据（见跨模型实验记录）；过滤对 Recall 增量未达预注册门 +15%。

## 复算

```bash
python3 tests/okf_ablation/run_ablation.py --bundle datasets/okf_ablation/bundle_v2_15
python3 tests/okf_ablation/run_scale_ablation.py --from-datasets
python3 -m pytest tests/okf_reader_test.py tests/okf_export_test.py tests/okf_retrieval_test.py tests/okf_ablation -q
```

离线实验全部确定性；跨模型实验（`tests/okf_ablation/cross_model_consistency.py`）需模型 API，凭证走本机 `~/.agenticx/config.yaml`（不入仓库）。

完整报告：`.cursor/plans/2026-11-25-okf-knowledge-adapter.plan.md`（方案）、`2026-11-25-okf-ablation-report.md`（单库）、`2026-11-25-okf-scale-ablation-report.md`（规模化）、`2026-11-25-okf-cross-model-report.md`（跨模型）。

## 已知局限与下一步

- 打分器为词面重叠（确定性），换真实向量后端复测是下一个增量
- 跨模型一致性需多样本投票设计后才能作量化指标
- OKF v0.3 已发布（conformance 规则/信任分级），适配层 frontmatter 全量保留的设计天然兼容增量字段，映射与导出侧升级留待下一期
