# Enterprise Admin 从 API 扫模型

## What & Why

管理台 `/admin/models` 仅支持手动添加模型 ID；对齐 Near Desktop「从 API 获取模型」能力，减少运维手工录入并自动推断 capability。

## Requirements

- FR-1: 模型列表区提供「从 API 获取模型」入口（刷新按钮 + tooltip）
- FR-2: 调用上游 `GET /models`（Ollama 走 `/api/tags`）返回可搜索弹窗
- FR-3: 弹窗内 `+` 添加/启用、`-` 禁用，与 Desktop 可见性语义一致
- FR-4: 扫入时推断 capabilities（text/vision/reasoning）；GLM-5.1 不得误标 vision
- NFR-1: Key/地址未配置时禁用扫模型；错误与 warning 就近展示

## Acceptance

- AC-1: 配置 Key 后点击刷新可弹出模型列表
- AC-2: 搜索、`+/-` 可启用/禁用模型并落库
- AC-3: `infer-model-capabilities` 单测覆盖 GLM-5.1 / GLM-4.5V
