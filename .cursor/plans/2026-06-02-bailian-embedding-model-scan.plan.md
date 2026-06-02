# 百炼 Embedding 模型扫描与标识

## What & Why

模型服务「从 API 获取模型」需像 Cherry Studio 一样展示百炼文本/多模态向量模型，并用「嵌入」标识区分；embedding 健康检测应走 `/embeddings` 而非 `/chat/completions`。

## Requirements

- **FR-1**: `fetch-models` 对百炼（含 dashscope URL）合并文档中的 embedding SKU，并与 `/models` 结果去重。
- **FR-2**: 根据模型 ID 推断 `chat | embedding | multimodal_embedding | reasoning`，UI 展示对应标识（嵌入 / 推理 / 工具）。
- **FR-3**: embedding 类模型健康检测调用 OpenAI 兼容 `POST /embeddings`。
- **FR-4**: 知识库「嵌入模型」下拉从模型服务可见列表中筛选 embedding 类 SKU（与百炼扫描结果联动）。
- **AC-1**: 百炼 provider 刷新后列表含 `text-embedding-v4`、`multimodal-embedding-v1` 等且带「嵌入」标签。
- **AC-2**: 对 embedding 模型点「检测」不因 chat/completions 误报失败。
- **AC-3**: 知识库 Bailian 嵌入模型下拉展示模型服务中已设为可见的 embedding 模型。

Made-with: Damon Li
