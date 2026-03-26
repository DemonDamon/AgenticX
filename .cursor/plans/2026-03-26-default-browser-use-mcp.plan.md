# 首次安装预置 browser-use MCP

## What & Why

新用户安装 Machi 后无需手抄 `mcp.json`；若不存在 `~/.agenticx/mcp.json`，自动生成并包含 `browser-use`（`uvx` + MCP），与 `examples/browser-use-mcp.md` 一致。密钥不写盘，沿用进程环境（如 `OPENAI_API_KEY`）。

## Requirements

- FR-1: 保证 `~/.agenticx/mcp.json` 含默认 `browser-use`：文件不存在则创建；文件存在但缺少该 key 则**合并**写入，不删其它 MCP、不覆盖已有 `browser-use`。
- FR-2: 预置条目与文档示例一致：`uvx` + `browser-use[cli]` + `--mcp`，`timeout` 600。
- FR-3: 连接名为 `browser-use` 且为上述默认 `uvx` 配置时，在拉起 MCP 前自动执行 `uvx browser-use install`；失败时返回可读错误（API / 工具结果中带原因），不要求用户手改 JSON。
- NFR-1: 在 `load_available_servers()` 入口调用，保证 Studio/Desktop 任意加载路径生效。

## AC

- AC-1: 单测：`$HOME` 指向临时目录时，首次调用创建文件且含 `browser-use`；再次调用不覆盖。
- AC-2: 单测：`preflight_browser_use_install` 在缺少 `uvx`、install 成功、install 失败三种情况行为正确。
