# 自研连接器网关总体规划（connector-runtime）

日期：2026-10-06
状态：待评审（关键选型确认后拆 subplan 执行）
前置：市场「连接器网关」条目已落地（可配置端点，commit af2965d4）；Enterprise 治理网关参照设计已成文（commit fea9229b）
机制参照：上游开源网关调研证据 E-001~E-016（research/codedeepresearch/ 归档，SHA eb4cb13）。**提交与对外文档不提上游项目名，溯源只走 research 归档。**

## 1. 目标与定位

一套自研网关核心，两种部署形态，彻底替代对外部网关服务的依赖：

- **C 端（Near Desktop）**：随桌面分发的本地 sidecar，个人连接器供给，零外部服务。
- **企业（Enterprise）**：并入 AI Gateway 的连接器模块，内网部署，治理级（凭据/策略/审计）。

两形态**同一 Go 核心**：同一套连接器定义模型、执行器、MCP 工具面；差异只在部署形态、凭据存储与治理深度。这就是「两边同一套网关层」的实现方式。

## 2. 关键选型

### 2.1 语言：Go

- 企业网关是 Go → 连接器模块可**进程内嵌**（mcphost 新增 connector backend 类型），真正融入而非旁挂。
- 交叉编译**单文件二进制** → C 端 sidecar 的理想形态：无 Node 版本约束、无运行时依赖、三平台分发。
- MCP 官方 Go SDK 可用。

不选 Node/TS（嵌不进 Go 网关、单二进制分发弱）；不选 Python（分发与运维弱）。

### 2.2 供给策略：不重建公共 provider 大目录

- 企业：**OpenAPI 导入**生成连接器（内部应用为主）+ 少量手工精修。
- C 端：精选高频连接器（个位数起步）+ OpenAPI 导入（进阶用户）。
- 市场既有「连接器网关」条目**保留**：可配置端点设计不变，自研 sidecar 成为默认推荐形态；外部网关仍可选（需要大目录的用户自行接入）。

### 2.3 命名与合规

- 机制参照为主（架构蒸馏，重实现）；如确需借用代码片段，该文件保留 Apache-2.0 声明（内部合规留痕，不进对外文案）。
- 新提交与对外文档不提上游项目名（沿用仓库既有约定）；完整溯源只在 research 归档。
- 不搬第三方品牌资产。

## 3. 核心架构（九个机制，全部有参照证据）

| # | 机制 | 要点 | 参照证据 |
|---|---|---|---|
| 1 | 连接器定义模型 | 声明式 YAML/JSON：id / auth 类型 / actions（id、input/outputSchema、operationType=read\|write\|destructive、requiredScopes） | E-007/E-008 |
| 2 | 目录生成 | 定义为源 → 生成目录 → 内存 CatalogStore（ETag 缓存），防手改漂移 | E-006 |
| 3 | 连接管理 | oauth2 授权码 + 客户端凭证 / api_key / none；token 自动刷新 | E-007 |
| 4 | 凭据保管 | AES-GCM 加密；主密钥 C 端本地文件 / 企业 KMS 或 env；凭据永不进 Agent | E-004 |
| 5 | 动作执行 | SSRF 守护（重定向 Location / DNS 解析校验）、超时、错误语义（400/502/504） | E-010 |
| 6 | 策略 | 动作级 allow/block（glob）+ 连接级授权；企业形态接现有策略引擎 | E-003/E-004 |
| 7 | 审计 | executionId 贯穿 + 脱敏日志；企业形态写 gateway_audit_events | E-003 |
| 8 | MCP 面 | 5 个发现型工具（搜索-发现-执行），无状态 Streamable HTTP | E-003 |
| 9 | 认证 | admin token（管理面）/ runtime token（运行面）分离 | E-004 |

## 4. 两种部署形态

| | C 端 sidecar | 企业内嵌 |
|---|---|---|
| 载体 | 单文件二进制随桌面分发，按需拉起 localhost | apps/gateway 进程内模块（mcphost connector backend） |
| 凭据存储 | 本地加密文件（单用户） | PG 加密列 / KMS（多租户） |
| 治理 | 个人级（简单 allow/block） | 策略引擎 + 审计 + 计量全链路 |
| 供给 | 精选包 + OpenAPI 导入 | OpenAPI 导入（内部应用）+ 定制包 |
| MCP 端点 | `http://127.0.0.1:<port>/mcp` | 网关 `/mcp/connector/*` 路由 |

## 5. Subplan 拆分

| subplan | 内容 | 交付与验收 |
|---|---|---|
| 01 核心运行时（Go，TDD） | 定义模型 / 目录 / 连接 / 凭据 / 执行器 / 策略 / 审计 / MCP server | 单二进制 + 2~3 个 no-auth 连接器；CLI 或 CDP 验证 search → execute |
| 02 桌面集成 | sidecar 生命周期（拉起/健康检查/退出回收）、市场条目新增「内置」默认形态、连接管理 UI、token 引导 | 桌面全链路：安装 → sidecar 自启 → 对话内执行动作，零外部服务 |
| 03 企业内嵌 | mcphost connector backend、PG 凭据库、策略/审计接线、OpenAPI 导入管线、内部应用样例连接器 | 内网治理链路：策略拦截 1 个动作 + 审计可查 |
| 04 供给与加固 | OAuth top providers、连接器包格式与签名、脱敏、限流 | 连接器包生态基础 |

执行顺序：01 →（02 与 03 可并行）→ 04。01 先行，独立可交付。

## 6. MVP 验收

- C 端：市场安装「内置连接器网关」→ sidecar 自启 → 对话内 search_actions → execute no-auth 动作成功；**全程不依赖任何外部网关服务**。
- 企业：OpenAPI 导入一个内部应用 → 动作执行过策略/审计 →「谁何时用哪个连接执行了什么」可查。
- 回归：桌面市场 112 用例零回退；企业网关既有测试零回退。

## 7. 主要风险

| 风险 | 缓解 |
|---|---|
| Go MCP SDK 成熟度 | 封装 transport 层，MCP 面保持薄（5 工具） |
| OAuth 各 provider 差异大 | 04 阶段逐个啃，C 端先 no-auth + api_key 起步 |
| sidecar 本地安全 | 仅绑定 127.0.0.1 + runtime token + 凭据落盘加密 |
| 双形态漂移 | 核心打成单一 Go module，两形态只做装配差异，CI 双端编译 |

## 8. 边界（不做）

- 不重建、不自维护 1,579 公共 provider 目录。
- 不做凭据进 Agent/客户端的捷径（即使 C 端）。
- C 端不做多租户/组织级治理（企业形态的事）。
- 不 fork 上游代码库。
