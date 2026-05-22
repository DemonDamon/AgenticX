# Cache Token 分价计费（客户口径）

Enterprise Gateway 计量支持以下维度：

- `cached_tokens`：OpenAI / DeepSeek 等 prompt cache 命中
- `cache_read_input_tokens` / `cache_creation_input_tokens`：Claude prompt caching
- 网关 L1/L2 命中：`usage_source=gateway_cache`，按折扣单价计入账单

Admin Console「四维消耗」页与 CSV 导出已包含 cache 列。
