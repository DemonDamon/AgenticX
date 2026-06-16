# Desktop Ollama 厂商适配

## What & Why

Near 设置里「添加服务厂商」仅支持 OpenAI 兼容类型，且保存时对所有厂商自动追加 `/v1`，导致 Ollama 请求落到 `/v1/api/generate` 返回 404。需支持 Ollama 厂商类型，并修正 base_url 规范化与模型拉取/连通性检测。

## Requirements

- FR-1: 「添加服务厂商」可选择 OpenAI 兼容或 Ollama
- FR-2: Ollama（内置与 custom_ollama_*）保存 base_url 时不追加 `/v1`，并剥离误保存的 `/v1` 后缀
- FR-3: Ollama API 地址预览显示 `/api/chat`，非 `/v1/chat/completions`
- FR-4: 主进程 validate-key / fetch-models 对 Ollama 走 `/api/tags`
- FR-5: ProviderResolver 支持 `interface=ollama` 与 `custom_ollama_*`
- FR-6: Ollama 模型若输出 JSON 形态 `tool_calls` / `thought` 文本，运行时须解析或清洗，不得原样展示

## Acceptance

- AC-1: 侧栏可添加 Ollama 类型自定义厂商，保存后 config 含 `interface: ollama` 且无 `/v1` base
- AC-2: 内置 Ollama 填 `http://host:11434` 保存后仍为原址
- AC-3: `pytest tests/test_llm_provider_resolver.py` 新增 custom ollama 用例通过
- AC-4: `pytest tests/test_agent_runtime_inline_tool_call.py` 覆盖 JSON tool_calls 与 thought-only 清洗
