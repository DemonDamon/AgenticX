# connector-runtime 子计划 02：桌面端集成（sidecar 形态）

日期：2026-10-06
母计划：[2026-10-06-connector-runtime-master.plan.md](./2026-10-06-connector-runtime-master.plan.md)
前置：subplan 01（核心运行时单二进制）
状态：待启动（01 完成后可执行，与 03 可并行）

## 1. 目标

C 端桌面全链路：市场安装「连接器网关（内置）」→ 桌面拉起 sidecar 单二进制 → 对话内 search_actions / execute_action，**零外部服务依赖**。

## 2. 工作分解（中粒度）

| # | 模块 | 内容 | 验收 |
|---|---|---|---|
| D1 | 二进制分发 | connector-runtime 三平台产物纳入桌面打包（resources/sidecar/），随安装分发；版本与桌面版本对齐 | 安装包内存在三平台产物，桌面按平台选用 |
| D2 | 生命周期管理 | 桌面主进程按需拉起 sidecar（安装网关条目后首次使用时）、健康检查 `/healthz` 轮询、退出/卸载时回收进程；端口分配与冲突重试 | 安装→自启→对话可用；桌面退出后无残留进程 |
| D3 | 安装形态切换 | 市场既有 GatewayInstallModal 增加「内置」默认形态（生成 runtime token、写入 mcp.json 指向 `http://127.0.0.1:<port>/mcp`）；外部端点形态保留 | 安装后 mcp.json 正确；既有 112 用例零回退 |
| D4 | 连接管理 UI（最小） | api_key 连接的创建/删除入口（管理面走 sidecar `/admin/*`）；no-auth 连接器零配置直接用 | 用户可为 api_key 连接器配置密钥并执行成功 |
| D5 | i18n 与文案 | zh/en 双语词条补齐 | 切换语言无缺失键 |

## 3. 关键决策预留

- sidecar 拉起权：主进程 vs 渲染进程（预期主进程，Node child_process）。
- token 传递：桌面生成随机 runtime token，经命令行参数注入 sidecar，同时写入 mcp.json env。
- 数据目录：跟随桌面用户数据目录（如 `~/.agenticx/connector-runtime/`），卸载清理策略。

## 4. 验收（AC）

- 端到端：市场安装（内置形态）→ sidecar 自启 → 对话内 `search_actions` 有结果 → `execute_action`（no-auth）成功 → 桌面退出 sidecar 回收。
- 回归：桌面市场既有 112 用例零回退。
- 全程网络出网仅连接器目标 API，无网关外部服务。
