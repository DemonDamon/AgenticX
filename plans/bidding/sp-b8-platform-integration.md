# SP-B8：底座集成与交付工程

> 需求映射：需求书 3.3 系统管理与配置中心、四（非功能）、五（数据安全合规）、六（系统集成与接口）；技术审查表可扩展性考核
> 人天：94（后端 48 / 算法 3 / 前端 16 / 测试 27）
> 前置：脚手架 W1 启动，集成收尾在 M4 后
> 里程碑：M1（W3）脚手架 + CI；W6 压测与安全；W9 私有化交付

## 1. 目标

bidding 业务 feature 挂载进 Enterprise 门户与管理台；五类业务角色与字段级权限；采购系统 API 双向集成；性能压测达标；安全合规扩展；容器化部署与私有化打包、三栈联调。

## 2. 复用盘点

| 能力 | 位置 | 说明 |
|------|------|------|
| feature package 机制 | `enterprise/features/`（iam/audit/chat 为成熟样板：api/services/components/types 结构） | bidding feature 照此结构新建 |
| Portal/Admin 应用 | `enterprise/apps/web-portal`、`admin-console`（src/app/components/i18n/lib/providers） | 菜单/路由/RBAC scope 打通 |
| IAM/RBAC/部门树/CSV 导入 | `enterprise/features/iam/`（rbac.ts、roles/users/departments services） | 五类角色扩展 |
| Gateway | `enterprise/apps/gateway`（Go：鉴权/审计/策略/计量） | BFF 代理与路由 |
| 智能体控制面 | 智能体注册/发布/回收、绑定 KB 与工具、配额（10-14~16 落地） | 问答智能体按项目装配 |
| Trace 观测页 | admin-console 运行观测（调用链/错误上浮/会话详情，54f0866ed 刚补齐） | 业务工具调用链做证据链观测 |
| 审计/策略 | `enterprise/features/audit/`、policy | 操作日志、内容合规 |
| 部署 | `deploy/`（docker-compose 全量/minimal/core/HA + observability）、`enterprise/deploy/`（nginx/gateway 配置）、`customers/AgenticX-HC/` 私有化样板 | k8s/HPA 参数化复用 |

## 3. 增量设计

### 3.1 bidding feature 脚手架（15 人天主体）

```
enterprise/features/bidding/
├── src/
│   ├── api/            # BFF 调用封装（项目/文件/解析/偏离/评分/风险/问答）
│   ├── services/       # 业务服务层
│   ├── components/     # SourceViewer、对比表、规则编辑器等
│   ├── types.ts        # 与 agenticx/bidding Pydantic 模型对齐的 TS 类型
│   └── index.ts
```

- 挂载 web-portal（业务工作区菜单）+ admin-console（规则/模板/审计管理）
- RBAC scope：`bidding:project:read`、`bidding:review:score`、`bidding:rule:write` 等细粒度 scope 注册
- Gateway BFF：`/api/bidding/*` 路由到 Python 服务（`agenticx/server/` 扩展），带鉴权与审计埋点

### 3.2 权限与角色扩展（9 人天）

五类角色：系统管理员、采购经办人、评审专家、采购负责人、合规审计。基于现有 RBAC 增量：

- 角色-scope 映射种子数据
- **字段级权限**：敏感字段（联系人/手机号/账号）对非授权角色脱敏展示——响应序列化层拦截器实现
- **项目数据隔离**：所有 bidding 表查询强制带 project scope（仓储层统一注入，禁止跨项目访问，评测用例覆盖越权）

### 3.3 采购系统 API 双向集成（20 人天主体）

```
同步范围：采购项目基础信息、供应商信息、投标文件归集、最终评审结果
```

- 适配层 `agenticx/bidding/integration/procurement/`：接口文档 W1 到位后开发（风险项，见 master plan §8）
- **可靠性**：双向同步全走副作用账本（`agenticx/reliability/call_ledger`）——崩溃恢复后不重复外部写；对账任务定期核对两侧状态，差异自动补推
- 回调接收：文件归集推送 + 验签

### 3.4 性能与非功能（12 人天）

- flow/longrun 编排、重试、停滞检测复用；批量队列/优先级/断点状态展示（SP-B1）联动
- 压测：50 并发在线操作、页面响应 ≤1s、报表 ≤3s、批量解析 500 份 ≤30min（k6 + 约定算力环境）；解析任务与在线服务分池（k8s node pool + HPA）
- 断点续传/续跑、单文件异常不影响整批（SP-B1 已实现，此处验证）

### 3.5 安全合规扩展（9 人天）

- 复用：Gateway 鉴权、audit、policy 内容合规、会话私有目录、出站域名允许列表
- 扩展：投标文件与解析数据**加密存储**（对象存储侧加密 + 敏感字段应用层加密）、日志 10 年归档方案（冷存储分层，容量甲方提供）、备份 90 天与误删恢复演练

### 3.6 业务工具接入 runtime 与观测（13 人天主体）

- bidding 业务操作封装为 tools 注册进 agent runtime（复用 `agenticx/tools/base.py` 契约与注册机制、凭证引用）
- SSE 长任务进度推送（解析/比对任务）
- 复用 admin Trace 观测页：业务工具调用链作为评审证据链的运行观测（评委操作 → 工具调用 → 数据来源全程可查）

### 3.7 容器化与三栈联调（4 + 12 人天）

- docker-compose 开发环境参数化（双环境：dev/prod 配置分离）
- 三栈联调：Python runtime + Next.js + Go Gateway + MinerU 引擎 + 内网模型适配（Ollama/OpenAI 兼容网关）
- 私有化安装包：参照 `customers/AgenticX-HC/` 样板产出 bidding 交付包（release 分支 `54f0866ed` 基线）

## 4. 任务分解

| 任务 | 岗位 | 人天 |
|------|------|------|
| 权限与角色管理扩展（字段级/项目隔离） | 后端 4 / 前端 3 / 测试 2 | 9 |
| 采购系统 API 双向集成（账本对账） | 后端 15 / 测试 5 | 20 |
| 性能压测与非功能验证 | 后端 5 / 算法 3 / 测试 4 | 12 |
| 安全合规扩展（加密/脱敏/归档） | 后端 5 / 前端 1 / 测试 3 | 9 |
| 容器化部署与双环境 | 后端 2 / 测试 2 | 4 |
| Enterprise feature 挂载脚手架 | 后端 5 / 前端 7 / 测试 3 | 15 |
| 业务 tools 接入与链路观测 | 后端 7 / 前端 3 / 测试 3 | 13 |
| 三栈联调与私有化打包 | 后端 5 / 前端 2 / 测试 5 | 12 |
| **合计** | 后端 48 / 算法 3 / 前端 16 / 测试 27 | **94** |

## 5. 验收标准

- 门户/管理台菜单完整挂载，五类角色权限矩阵验收（含字段脱敏与跨项目越权用例）
- 采购系统双向同步 + 对账：崩溃恢复不重复写、差异补推（故障注入用例，复用 `agenticx/evaluation/fault_injection.py` 思路）
- 50 并发 / 页面 ≤1s / 报表 ≤3s / 批量 30min 压测报告
- 加密存储、脱敏、10 年日志归档、90 天备份恢复通过安全验收
- 私有化安装包在洁净环境一键部署成功（HC 样板同标准）

## 6. 依赖与风险

- 依赖：全部业务 sub-plan（集成收尾）；W1 采购系统接口文档到位（**关键路径**，未到位则集成模块顺延并走变更）
- 风险：字段级权限的序列化拦截性能 → 热路径白名单 + 压测验证；release 分支与 main 的底座热修同步 → 每周 cherry-pick 例行化
