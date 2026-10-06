# connector-runtime 子计划 03：企业网关内嵌（治理形态）

日期：2026-10-06
母计划：[2026-10-06-connector-runtime-master.plan.md](./2026-10-06-connector-runtime-master.plan.md)
前置：subplan 01（核心运行时 Go module）
状态：待启动（01 完成后可执行，与 02 可并行）
参照基线：[enterprise/docs/gateway/governance-mcp-gateway-reference.md](../../enterprise/docs/gateway/governance-mcp-gateway-reference.md)（机制映射表为需求基线）

## 1. 目标

connector-runtime 核心以 Go module 形式**进程内嵌**进 `enterprise/apps/gateway`（mcphost 新增 `connector` backend 类型），成为企业内网的连接器供给与治理入口：凭据入 PG、执行过策略引擎、审计入 `gateway_audit_events`。

## 2. 工作分解（中粒度）

| # | 模块 | 内容 | 验收 |
|---|---|---|---|
| E1 | module 复用 | gateway go.mod 引入 `github.com/agenticx/connector-runtime`；装配差异层（企业形态的连接存储/审计 sink 实现 core 接口） | 进程内嵌编译通过；两形态共享同一 core |
| E2 | mcphost connector backend | 新增 backend 类型 `connector`：注册 5 工具到既有 tools/call 管线（策略→配额→审计既有链路不变） | `/mcp/connector/*` 或既有 mcp 路由下 5 工具可调 |
| E3 | PG 凭据库 | 连接/凭据存储从本地加密文件切换为 PG 加密列（KMS/env 主密钥）；连接生命周期（授权/轮转/撤销） | 多实例共享连接；密钥不落业务表明文 |
| E4 | 策略/审计接线 | 动作级 allow/block 并入现有策略引擎评估链（mcp_tool 阶段后追加 connector 阶段）；executionId 贯穿写入 gateway_audit_events | 策略拦截 1 个动作可复现；审计可回答「谁何时用哪个连接执行了什么」 |
| E5 | OpenAPI 导入管线 | 管理端点/CLI：上传 OpenAPI 文档 → 生成连接器定义（operation 标注 read/write， destructive 需人工确认）→ 进入目录 | 导入一个内部应用定义并成功执行 1 个动作 |
| E6 | admin-console 最小 UI | 连接管理页（列表/新建/撤销）+ 导入入口 | 内网治理链路可视可用 |

## 3. 与桌面的衔接钩子

桌面网关条目端点可配置（subplan 01 已落地），企业形态上线后：企业网关 URL 作为推荐值/管理面下发，桌面安装管线零返工。

## 4. 验收（AC）

- 内网治理链路：OpenAPI 导入内部应用 → 桌面/edge-agent 通过网关执行动作 → 策略拦截可复现 → 审计含连接/动作维度。
- 回归：企业网关既有测试零回退。
- 部署：内网单镜像（gateway 进程内含连接器能力），无 Node 依赖。
