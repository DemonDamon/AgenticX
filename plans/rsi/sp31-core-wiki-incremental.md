# SP31: 核心仓 Wiki 编译链路升级——增量编译 + 合并写入 + 矛盾保留（SP30 引擎产品化落地）

> 定位：SP30 编译引擎从实验仓（envharness）产品化到核心仓（AgenticX）brain 链路的第一步。
> 背景：用户反馈 SP30 只落在实验仓"感受不到价值"；价值出口是 Near 桌面端 + Enterprise。

## 需求

现状（`agenticx/brain/wiki_compiler.py` `compile_source`）：每次"重新构建"对每个文档跑两次 LLM 全量重生成，页面直接 `write_text` 覆盖。三个问题：

1. **重复烧钱**：源文档没变也全量重编（两次 LLM 调用）
2. **覆盖丢知识**：A 文档生成的页面内容会被 B 文档编译时整体覆盖（跨源知识互相冲掉，正是推文"三个答案打架"的根因）
3. **矛盾不可见**：多源冲突既不保留也不显性标记

## 改造内容

1. **输入指纹跳过**：`wiki/.compile_state.json` 记 `{source_path: {sha, pages[]}}`；源文本 sha 未变 → 跳过 LLM 全程（队列 `result.get("skipped")` 分支早已预留，`wiki_compile_queue.py` L132-133，编译器从未产出）
2. **合并写入（merge-on-write）**：LLM 产物改为结构化页面契约（`## 要点` 逐条带 `（来源: X）`），写入时走 `integrate_merge`：同 claim 合并溯源、新 claim 追加、`sources` frontmatter 并集——跨文档页面知识只增不丢
3. **矛盾保留**：generation prompt 明确要求"新证据与已有 wiki 冲突时在页面写 `## 矛盾` 段，双方各带来源"；合并引擎解析/重渲染时保留该段（LLM 判断冲突，引擎保证不丢）
4. **不破坏存量**：非结构化（手写/旧版）页面且非本文档所有 → 跳过写入并记录 preserved，一字节不动
5. **页面归属**：state 记录每个文档写过的页面；同文档重编自己拥有的页面可覆盖，跨文档只能合并

## 验收标准

- 文档未变时"重新构建"：零 LLM 调用，队列状态显示 skipped（<1 秒）
- A、B 两文档先后编译产出同一主题页面：A 的 claim 在 B 编译后仍在，`sources` 含 a、b 两者
- LLM 在页面写的 `## 矛盾` 段，跨合并存活
- 手写非结构化页面在任何编译后字节不变
- 既有测试零回归（test_wiki_compile_queue / test_wiki_graph_payload）
- Near 桌面端"重新构建"行为可见变化：未变文档瞬时完成；页面含跨源来源

## 不做

- 不改前端（WikiBrowseView/KnowledgeWikiPanel 已能渲染新格式——SP30 E2E-6 已真机验证）
- 不做 NLP 语义矛盾检测（矛盾判定交给 LLM，引擎只做确定性保留）
- memory/kb 检索分级（L0/L1）为下一子项，不在本计划

## 引擎来源

`agenticx/brain/wiki/`（page.py/merge.py）移植自 `envharness/envharness/experience_wiki/`（SP30b 交付，已 156 测试 + Near 真机验证），按 brain 页面约定适配（矛盾段解析/渲染扩展）。两侧暂时各自维护，统一为共享包是后续统一上下文层（SP30 北极星）的工作。
