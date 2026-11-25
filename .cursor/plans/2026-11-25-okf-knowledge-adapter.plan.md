# okf-knowledge-adapter

Planned-with: glm-5.4
Planned-date: 2026-11-25
Baseline: 6e3ed975 (main)
Spec: OKF v0.2（2026-07-24 发布，Google Cloud 开源规范）

## 背景与目标（Evidence and scope）

OKF（Open Knowledge Format）= YAML frontmatter + Markdown 目录树的知识表示格式。必填字段仅 `type`，字段族分四类：`sources`（溯源）、`generated`/`verified`（信任）、`status`/`stale_after`（生命周期）、计算族（Attested Computation，本期不做）。完整调研见飞书下发文档《OKF_Open_Knowledge_Format_调研文档》。

纳入理由：AgenticX 的知识目前锁在 vector store / memory backend 运行时内部，缺一个可 git、可 diff、跨组织交换的知识出口。OKF 是纯文件规范、零运行时依赖、厂商中立，与框架"零依赖自包含"路线一致——纳入形态是格式适配层，不是生态搬运。

**In scope**：读入（OKF Bundle → Document）、写出（Document → OKF Bundle）两条路径，检索元数据过滤的通路验证，以及 FR4 消融实验（OKF 价值的量化验证）。

**Out of scope**：enrichment agent、审核 UI、静态可视化器（Google 参考实现与生态工具，不搬）；Concept 间 Markdown 链接的图谱映射、Bundle 的 MCP 暴露、agent 上下文挂载协议（各立后续独立 plan）；不新增任何第三方依赖（PyYAML 已是核心依赖，`pyproject.toml` L40）；不新建 example 目录、不加业务入口（核心仓库约束）。

## 现有基础设施对位（证据）

| 落点 | 现有设施 | 差距 |
| --- | --- | --- |
| Reader 注册 | `readers/__init__.py` `READER_REGISTRY` + `register_reader()` + `get_reader(reader_name=...)` | 仅缺 okf 实现 |
| 目录递归读入 | `knowledge.py::add_from_path(path, reader_name, recursive=True)` | 零改动可用 |
| 文档模型 | `document.py::DocumentMetadata`：`source`/`source_type`/`tags`/`custom`（自由 dict） | 零改动可承载 |
| 检索过滤 | `memory/knowledge_base.py::search(metadata_filter=...)` | 零改动可用 |
| frontmatter 解析 | `skills/frontmatter.py` 为标量正则（扁平 SKILL.md 场景） | OKF 有嵌套结构（`sources` 列表、`generated` 映射），改用 PyYAML 全量解析，不走 skills 实现 |

## FR1 — OKFReader（读路径）

新增 `agenticx/knowledge/readers/okf_reader.py`，实现 `BaseReader` 接口：

1. **Bundle 扫描**：遍历目录树内全部 `.md`；保留文件 `index.md` / `log.md` 跳过（规范明文：不能用作 Concept）。
2. **frontmatter 解析**：PyYAML 解析嵌套结构；坏 YAML 时按 OKF 宽容消费原则降级为纯文本入库（log warning，不拒收不抛错——对应规范"消费者不得因未知字段/格式缺陷拒收整个 Bundle"）。
3. **字段映射**（映射逻辑单点集中，版本演进只改此处）：

| OKF frontmatter | DocumentMetadata 落位 |
| --- | --- |
| `type` | `custom["okf"]["type"]` |
| `title` | `name`（缺失回退 concept_id） |
| `tags` | `tags` |
| `resource` | `source` |
| `status` / `stale_after` / `generated` / `verified` / `sources` | `custom["okf"][...]` 原样保留 |
| 未知字段（`owner`、`pii` 等） | `custom["okf"]` 原样保留（round-trip 保真） |
| Concept ID（相对路径去 `.md`） | `custom["okf"]["concept_id"]` |
| （正文 body） | `Document.content` |

4. **注册**：`READER_REGISTRY` 增加 `'okf'`；`EXTENSION_MAPPING` **不改**——`.md` 保持 text 默认，OKF 必须显式 `reader_name='okf'` 调用，避免普通 Markdown 目录误判。
5. **调用方式**：`Knowledge.add_from_path(bundle_path, reader_name='okf', recursive=True)`。

## FR2 — OKF 导出（写路径）

新增 `agenticx/knowledge/okf_export.py`：`export_bundle(documents, output_dir)`：

1. Document → Concept：`content` 作 body；`custom["okf"]` 字段按原样写回 frontmatter（含未知字段）。
2. 无 okf 元数据的文档生成最小合法 frontmatter：`type: Reference`（或调用方指定）+ `generated: {by: process:agenticx-export, at: <ISO8601 UTC>}`。
3. 目录组织按 `custom["okf"]["concept_id"]` 相对路径写；无 concept_id 时按 `name` 平铺。
4. 导出动作记入 `generated`（`process:agenticx-export` + 时间戳），符合 Actor 命名约定。
5. **round-trip 保真断言**：读入 → 导出 → 再读入，frontmatter 字段集合与值等价，未知字段不丢失。

## FR3 — 检索通路验证（不改检索代码）

- 验证 `KnowledgeBase.search(metadata_filter={"custom.okf.type": ...})` 按 OKF `type`/`status` 过滤召回的通路（现有机制，仅测试用例证明可用）。
- `stale_after` 过期排除仅作为测试用例验证元数据可达，不改召回产品语义。

## FR4 — 消融实验（OKF 价值验证）

**实验问题**：OKF 适配层相对裸 RAG 的增量价值来自哪一层——结构边界（Concept 粒度）、元数据过滤、溯源拼装、还是信任层级？逐层关闭特性量化贡献，避免"纳入即有价值"的未经验证假设。

**实验臂**（单变量递增；固定查询集、固定种子、固定模型、匹配调用预算——每个 arm 只开一个特性增量）：

| 臂 | 配置 | 验证的 OKF 特性 |
| --- | --- | --- |
| A0 | 裸文本 + 默认 chunking + 纯向量召回（现状 baseline） | — |
| A1 | 按 Concept 粒度入库（OKF 结构边界替代固定 chunking），元数据不参与 | 知识单元边界 |
| A2 | A1 + 召回后按 `status`/`type`/`stale_after` 过滤（deprecated 与已过期排除） | 元数据过滤 |
| A3 | A2 + 命中结果拼 `sources` 溯源进上下文 | 溯源 |
| A4 | A3 + `verified` 信任层级参与召回排序（human-reviewed 优先） | 信任层级 |

**实验数据集**：fixture Bundle v2——在 FR1 fixture 上扩充：混入 `stable`/`draft`/`deprecated`/已过 `stale_after` 的 Concept、跨域干扰知识；标注查询集（每条查询标注应命中与应排除的 Concept ID），全部可离线构造，不依赖真实业务数据。

**指标**：

1. **检索质量**：Recall@10 / MRR / nDCG（应排除项命中记 FP；重点看 deprecated/过期知识是否被正确挡在召回外）。
2. **回答质量**：事实准确率（LLM-as-judge 盲评 A0 vs A4 输出，配对比较）+ 过期知识引用率（越低越好）。
3. **溯源可用性**：回答中论断的可核查率（citation coverage——沿 `sources`/脚注能回溯到源）。
4. **跨模型一致性**：同一查询与知识库，换模型（如 glm / deepseek / kimi 各一档）重复 A0 与 A4，对比跨模型回答 agreement rate——这是 OKF"跨模型一致性"核心卖点的直接检验。
5. **成本**：每查询上下文 token（元数据过滤减少无效 chunk → 上下文是否变省）。

**判定门（预注册）**：

- A2 vs A1：Recall@10 提升 ≥ 15% 且过期引用率下降 ≥ 50% → 元数据过滤价值成立；
- A4 vs A0：事实准确率配对提升显著 + token 不升 → OKF 整体价值成立；
- gate 未过即如实记录失败结论，不调参凑数；结论限定为 preliminary（fixture 数据、单查询集）。

**落位与产出**：实验驱动放 `tests/knowledge/okf_ablation/`（可重复执行，种子/模型/臂参数化；跨模型臂与 LLM-judge 需外部模型 API，标记为本地手动运行，不进常规 CI gate；检索质量臂可用内存向量后端全离线跑）。全量跑一次产出报告 `2026-11-25-okf-ablation-report.md`（数据表 + 配对结论 + 局限性说明），与 plan 同目录归档。

## 验收与验证

- `readers/okf_reader_test.py`：fixture Bundle（覆盖 `type`/`sources`/`generated`/`verified`/`status`/`stale_after`/自定义未知字段/嵌套目录 + `index.md` + `log.md` 保留文件/坏 YAML 文件）→ 解析数量、字段映射正确性、保留文件跳过、降级路径不抛错。
- `okf_export_test.py`：round-trip 保真（含未知字段保留、`generated` 追加导出动作）。
- 端到端：fixture Bundle → `add_from_path(reader_name='okf')` → 内存向量后端 → `search` + metadata_filter 召回验证 → `export_bundle` → diff 校验。
- 消融实验：FR4 各臂按判定门跑完并出报告；离线检索臂指标进常规测试可复核，模型相关臂本地跑并留原始输出。
- 测试范围限定 knowledge 模块相关包，不动其他模块；不新增 example、不加业务入口、不加依赖。

## 风险与版本策略

- **OKF 处于 0.x 演进期**：v0.1→v0.2 已发生字段更名（`timestamp` → `generated`、`# Citations` → `sources`+脚注）。对策：原始 frontmatter 以完整 dict 存 `custom["okf"]`（不丢字段），映射逻辑集中在 reader 单点；本期锁定 v0.2 语义，升级只改映射层。
- **误判风险**：显式 `reader_name` 使用，杜绝普通 Markdown 目录被误按 OKF 处理。
- **零新增硬依赖**；`content_type` 现有 MIME 语义不动，OKF `type` 走 `custom` 通道，两套语义不混淆。

## 分期

- **本期**：FR1 + FR2 + FR3（读、写、检索验证）→ FR4 消融实验（实现完成即跑，产出价值验证报告）。
- **后续独立 plan（不在本期）**：Concept 间 Markdown 链接 → `graphers` 图谱边映射；Bundle 的 MCP 暴露；agent 上下文挂载协议（index.md 渐进披露的消费侧约定）。
