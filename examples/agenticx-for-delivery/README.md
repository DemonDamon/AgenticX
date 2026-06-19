# AgenticX Delivery Kit

Near Desktop **客户物料 → POC/MVP** 交付 bundle，随 `agenticx-delivery-kit` 安装到 `~/.agenticx/`。

## 内容

| 组件 | 说明 |
|------|------|
| 4 分身预设 | `delivery-analyst` / `delivery-designer` / `delivery-frontend` / `delivery-qa` |
| 4 Skills | 需求拆解、B2B 设计系统、Vite 脚手架、Playwright 测试 |
| 2 MCP | `figma-mcp`、`playwright-mcp`（合并进 `~/.agenticx/mcp.json`） |
| Demo 物料 | `sample-rfp.md` |

## 安装

```bash
# Studio 运行中
curl -X POST http://127.0.0.1:<port>/api/bundles/install \
  -H "x-agx-desktop-token: $AGX_DESKTOP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source_path": "/path/to/AgenticX/examples/agenticx-for-delivery"}'
```

或在 Near **设置 → 定时任务** 区保存交付配置后，从 Meta 窗格工具栏打开 **交付任务** 面板创建任务（首次会自动 bootstrap）。

## MCP 预置说明

- **playwright-mcp**：`npx -y @playwright/mcp@latest --headless`
- **figma-mcp**：`npx -y figma-developer-mcp`，需配置 `FIGMA_API_KEY`（设置面板或 `delivery.figma_token`）

详见 `docs/guides/near-delivery-loop.md`。
