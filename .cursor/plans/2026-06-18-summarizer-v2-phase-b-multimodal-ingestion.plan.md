---
name: Summarizer v2 Phase B - Multimodal Ingestion Boundary
overview: 为业务无关内核补齐多模态接入边界。引入 ModalityAdapter 协议 + 能力矩阵，把图片/代码/文档转写成文本表征后再进文本内核；音视频做预留 skeleton。领域插件声明各自支持的模态（邮件最全，新闻文本+图片）。
todos:
  - id: b1-modality-base
    content: B1 modality/base.py 定义 Modality 部件结构、ModalityAdapter 协议、CapabilityMatrix
    status: pending
  - id: b2-text-code
    content: B2 text.py / code.py 适配器（直通 + 代码围栏保留）
    status: pending
  - id: b3-image
    content: B3 image.py 适配器（vision caption / OCR，复用框架 vision 能力 + liteparse，含降级）
    status: pending
  - id: b4-document
    content: B4 document.py 适配器（复用 liteparse 解析 pdf/docx/pptx）
    status: pending
  - id: b5-audio-video
    content: B5 audio_video.py 预留 skeleton，默认 NotSupported + 明确错误
    status: pending
  - id: b6-domain-modality
    content: B6 email/news 插件声明 supported_modalities，引擎按矩阵裁决并组装文本
    status: pending
  - id: b7-engine-parts
    content: B7 engine 支持 parts 输入：多部件→各适配器 to_text→拼接→走既有文本流水线
    status: pending
  - id: b8-tests
    content: B8 冒烟测试 test_phase_b_modality.py + README 多模态能力矩阵章节
    status: pending
isProject: false
---

# Phase B - 多模态接入边界

**Author:** Damon Li
**Date:** 2026-06-18
**Planned-with:** Claude Opus 4.8
**前置:** Phase A 完成（`core/types.py` 的 `Modality`、`SummarizeRequest.parts`、`DomainPlugin.supported_modalities` 已就位）。

## 设计立场（先读，避免做歪）

摘要内核保持**纯文本**。多模态的处理边界是「**进核前转写**」：任何非文本部件先经 `ModalityAdapter.to_text()` 变成文本表征（caption / OCR / 转写 / 解析文本），再交给 Phase A 的文本流水线。这样：
- 内核零改动即可「支持多模态」；
- 能力边界清晰可声明（能力矩阵）；
- 不支持的模态显式报错而非静默吞掉。

> ⚠️ 不要让内核直接处理二进制；不要自写 PDF/图像解析器——复用框架的 `liteparse` 与 `vision` 能力。使用前 `Read` 确认真实函数名与签名（见总览第 4 节）。

## 模态支持边界（本期目标）

| 模态 | 邮件域 | 新闻域 | 转写方式 | 本期状态 |
|------|:---:|:---:|------|------|
| 文本 | ✅ | ✅ | 直通 | 实现 |
| 代码 | ✅ | — | 保留围栏 + 语言标注，超长截断 | 实现 |
| 图片 | ✅ | ✅ | vision caption + OCR 文本 | 实现（无 vision 模型时降级为占位 + 告警） |
| 文档(pdf/docx/pptx) | ✅ | — | `liteparse` 解析为文本 | 实现 |
| 音频/视频 | 预留 | 预留 | 转写（ASR） | skeleton，调用即明确 `NotSupported` |

## 新增/变更文件

```
agenticx_service/modality/
  __init__.py
  base.py           # Modality 部件结构 + ModalityAdapter 协议 + CapabilityMatrix
  text.py
  code.py
  image.py
  document.py
  audio_video.py    # 预留
agenticx_service/core/engine.py     # 变更：支持 parts → 转写 → 拼接
agenticx_service/domains/email/plugin.py  # 变更：supported_modalities 扩展
agenticx_service/domains/news/plugin.py   # 变更：supported_modalities = {TEXT, IMAGE}
agenticx_service/app.py             # 变更：/v2/summarize 接收 parts
config_agenticx.yaml                # 变更：modality 段（vision 模型、liteparse 开关、单图/文档上限）
```

## 任务清单

- [ ] **B1 模态基座** `modality/base.py`
  - `@dataclass Part`: `modality: Modality`、`payload: str`（文本/代码原文，或图片/文档的本地路径或 base64）、`meta: dict`（如 `language`、`mime`、`filename`）。
  - `@dataclass TextRepr`: `text: str`、`source_modality: Modality`、`note: str = ""`（如「图片OCR」「文档解析」）。
  - `class ModalityAdapter(Protocol)`: `modality`; `can_handle(part) -> bool`; `async to_text(part, ctx) -> TextRepr`。
  - `class CapabilityMatrix`: 给定 `domain.supported_modalities()` 与可用 adapters，裁决某 part 是「转写 / 跳过 / 报错」；提供 `class ModalityNotSupported(Exception)`。

- [ ] **B2 文本 / 代码适配器** `text.py` / `code.py`
  - 文本：直通，`TextRepr(text=payload)`。
  - 代码：包裹为 ```` ```{language}\n...\n``` ````；超 `modality.code_max_tokens` 用 `truncate_text` 截断并在 `note` 标注。

- [ ] **B3 图片适配器** `image.py`
  - 优先：若配置了支持视觉的模型（参考 `agenticx/llms/vision.py` 的能力判定），用 LLM 对图片产出 caption + 关键文字（OCR）；消息走 OpenAI 风格 image content block（`Read` `litellm_provider.py` 确认 `image_inputs`/content 结构）。
  - 降级：无 vision 模型或调用失败 → `TextRepr(text="[图片：无法解析，已跳过]", note="vision unavailable")` 并 `logger.warning`，**不抛错**（图片通常是邮件附属，不应整体失败）。
  - 上限：单请求图片数 `modality.max_images`，超出丢弃并在 trace 标注。

- [ ] **B4 文档适配器** `document.py`
  - 用框架 `liteparse`（`Read` `agenticx/cli/agent_tools.py` 或对应 adapter 确认调用方式）解析 `pdf/doc/docx/ppt/pptx` → 文本；优先读顶层 `text`，缺失再拼 `pages[*].text`（与 workspace 既有约定一致）。
  - 未安装 liteparse：返回明确错误文本 + 安装提示（`npm i -g @llamaindex/liteparse`），记入 trace。

- [ ] **B5 音视频预留** `audio_video.py`
  - `AudioVideoAdapter.to_text` 直接 `raise ModalityNotSupported("audio/video summarization not enabled in this release")`。
  - 在 docstring 写清未来接入点（ASR/转写服务），保证 Phase B 之后可低成本补齐。

- [ ] **B6 领域模态声明 + 裁决**
  - email `supported_modalities = {TEXT, CODE, IMAGE, DOCUMENT}`；news `= {TEXT, IMAGE}`。
  - 引擎调用 `CapabilityMatrix`：part 模态不在 domain 支持集 → 按策略跳过并 trace 记录（不静默）；不在已实现 adapter → `ModalityNotSupported`。

- [ ] **B7 引擎接入 parts** `core/engine.py`
  - `summarize` 支持 `req.parts`：对每个 part 选 adapter `to_text`，按原顺序拼成 `combined_text`（各段前缀 `note`），随后**完全复用** A 阶段文本流水线（脱敏/guard/路由/resolve）。
  - `req.content` 与 `req.parts` 并存时：`content` 视为一个 `TEXT` part 置于最前。
  - `trace["modalities"]` 记录每 part 的处理结果（转写/跳过/降级）。

- [ ] **B8 测试 + 文档**（见下）。

## 冒烟测试 `tests/test_phase_b_modality.py`

- `test_text_passthrough` / `test_code_fenced_and_truncated`。
- `test_image_degrades_without_vision`（mock：无 vision → 占位文本 + 不抛错，trace 标 degraded）。
- `test_document_adapter_uses_liteparse`（monkeypatch liteparse 调用，返回桩文本）。
- `test_audio_video_not_supported`（断言抛 `ModalityNotSupported`）。
- `test_news_rejects_unsupported_modality`（给 news 传 DOCUMENT，按策略跳过并 trace 记录）。
- `test_engine_parts_concatenated_then_summarized`（stub LLM：text+code 两 part → 非空摘要，trace 含两模态）。

## 设计护栏

- 内核仍只吃文本；多模态全部在 `modality/` 内收敛。
- 图片失败降级、音视频显式报错——区分「可降级附属模态」与「不支持模态」。
- 复用 `liteparse`/`vision`，禁止自写二进制解析；禁止把大 base64 直灌进文本上下文（先转写/截断）。
- 不改 A 阶段已冻结的 `DomainPlugin`/`PromptResolver` 签名。

## 验收标准

1. text/code/image/document 四类 part 可端到端转写并进入摘要（stub/mock 下）。
2. 能力矩阵对「不支持模态」给出可观测结果（跳过+trace 或显式异常），无静默吞掉。
3. 音视频调用返回明确 `NotSupported`，预留接入点文档清晰。
4. README 新增「多模态能力矩阵」表，与代码声明一致。

Made-with: Damon Li
