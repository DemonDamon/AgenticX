# OKF 知识格式适配层

AgenticX 对 [Open Knowledge Format (OKF)](https://github.com/open-knowledge-format/open-knowledge-format)（Google 发起的开放知识格式）的读写适配：外部 OKF Bundle 可读入知识库，知识库可导出为 OKF Bundle 分发。本文说明能力边界、实验验证与复算方式。

## 为什么做

RAG 的一个实际缺陷：知识库里的过期/废弃知识会被检索捞出来，模型不知道它们过期，照着答就错。OKF 给每个知识（Markdown 文件）加了一段机器可读的元数据（frontmatter：status / stale_after / verified / sources），使"过期"成为可判定的事实而不是模型要猜的事。AgenticX 的 Knowledge/Memory 体系缺一个**可 git、可 diff、跨组织交换**的知识层，OKF 填这个位置。

## 能力

读：`Knowledge.add_from_path(path, reader_name='okf')`，支持 Bundle 目录树与单文件；frontmatter 完整存于 `custom["okf"]`（未知字段不丢失，round-trip 保真）；`title→name`、`tags→tags`、`resource→source` 提升到顶级 metadata，检索过滤可直接用。坏 YAML 宽忍降级为正文，不中断导入。

写：`okf_export(documents, bundle_root)`，导出为 Bundle 目录树，导出动作记 `process:agenticx-export` 溯源，含路径穿越防护与概念去重。

设计边界：`.md` 默认仍走 text reader，OKF 需显式指定；`content_type` 的 MIME 语义不动，OKF `type` 走 custom 通道——避免普通 Markdown 目录误判。

## 实验验证

数据集随仓库分发：`datasets/okf_ablation/`（15/60/200/600 四个规模共 875 个概念文件 + 查询标注），全部确定性可复算。图文讲解见飞书文档《[给 AI 用的知识要带过期日期：AgenticX 接入 OKF 的做法和验证](https://wv18cbjmgi0.feishu.cn/docx/L80TdLnTuodzJexHC4VcHaLonBh)》（内嵌四分区图解画板，SVG 源在 `diagrams/2026-11-25T181901/`）。

站得住的结论：

| 结论 | 数据 |
| --- | --- |
| 模型只看正文时分辨不出过期知识 | 三个模型（glm-5.3-flash / deepseek-v4.1-flash / MiniMax-M3）各 48 次调用里 0 次识别，全部照着过期内容作答 |
| 带上元数据后，模型能正确拒绝过期/废弃知识 | 同一批 12 条知识，三个模型 144/144 判“不可用”；6 条正常知识不误伤（216/216）；648 次调用零翻转 |
| 两条知识互相矛盾时（一条过期、一条现行） | 不带元数据：216 次里 213 次答“无法回答”；带元数据：216/216 答现行数值，调换先后顺序结果不变 |
| 程序可以按规则剔除过期知识 | 过滤规则（status 为 deprecated，或 stale_after 早于今天）直接剔除，不依赖文字相似度 |

三个模型的结果完全相同：模型之间本来就一致，缺的是答对。元数据的作用不挑模型。

已复核否定的数字：离线对比报告（`run_ablation.py`、`run_scale_ablation.py` 的输出）里的“上下文省 58%”“排序优势随规模变大”不成立。前者的对照组把文件头也算进了正文，去掉文件头后元数据比纯正文多 0~50% 的字符；后者七成来自打分函数用到了标题字段。那组对比用的是词面打分和自生成的查询，测的是脚本自己的打分函数。复核见 `audit_offline_claims.py` 与 `2026-11-25-okf-offline-audit-report.md`。

两组模型实验的适用范围：结果接近 0%/100%，说明的是干净场景（企业内部的简单知识、元数据完整、过期日期由提示词给出）下三个模型都做得到。真实向量检索下的过滤效果、状态缺失或有歧义时模型怎么处理，都还没有验证。

## 复算

```bash
python3 tests/okf_ablation/audit_offline_claims.py                    # 复核离线对比的数字
python3 tests/okf_ablation/cross_model_consistency.py --report-only   # 用已落盘的 648 次原始回答重出第一组报告
python3 tests/okf_ablation/mixed_fragments.py --report-only           # 用已落盘的 432 次原始回答重出第二组报告
python3 -m pytest tests/okf_reader_test.py tests/okf_export_test.py tests/okf_retrieval_test.py tests/okf_ablation -q
```

以上命令都不需要模型接口。两组模型实验的原始回答已落盘在 `datasets/okf_ablation/cross_model_raw.jsonl` 和 `mixed_fragments_raw.jsonl`；要重新调模型，去掉 `--report-only`，凭证走本机 `~/.agenticx/config.yaml`，不入仓库。

完整报告：`.cursor/plans/2026-11-25-okf-knowledge-adapter.plan.md`（方案）、`2026-11-25-okf-offline-audit-report.md`（离线数字复核）、`2026-11-25-okf-cross-model-report.md`（第一组模型实验）、`2026-11-25-okf-mixed-fragments-report.md`（第二组模型实验）。离线对比的原始报告 `2026-11-25-okf-ablation-report.md`、`2026-11-25-okf-scale-ablation-report.md` 也留在仓库里，其中“上下文省 58%”和排序两个数字已被复核否定。

## 已知局限与下一步

- 打分器为词面重叠（确定性），那组离线对比的数字不能说明检索质量；换真实向量后端和真实查询才能回答
- 两组模型实验只覆盖企业内部的简单知识、元数据完整的干净场景；状态缺失或有歧义、措辞不同的矛盾文档还没测。判断过没过期需要知道当天日期，落地时系统要把当前日期给模型，或由代码预先算好
- 元数据本身有上下文成本，比纯正文多 0~50% 的字符
- OKF 最新规范是 v0.3，规范仓库在 GitHub 组织 open-knowledge-format 下（GoogleCloudPlatform/open-knowledge-format 已标记弃用并指向新仓库；GoogleCloudPlatform/knowledge-catalog 的 okf 目录里是 v0.2）。v0.3 相对 v0.2 新增了 `superseded_by`、根目录 index.md 的元数据和 `x-` 扩展键规则，另有两处不兼容变化：相对路径从文件所在目录算起，信任等级只看当前有效的复核记录。适配器按 v0.2 编写，还没有用 v0.3 的 Bundle 实测
