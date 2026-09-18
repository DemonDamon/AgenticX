---
module_id: skill-registry
module_name: skill-registry
roots:
  - enterprise/apps/skill-registry
summary_schema: code-module-summaries/v1
---

# skill-registry

企业侧**窄技能注册服务**（FastAPI）。只回答「这个技能是什么、扫出什么」；**不连租户库**，写库由 admin-console 完成。

## Responsibility

- `GET /healthz`：探活，无 token。
- `GET /registry/search?q=`：搜公网/可配置注册表（`search_skillhub_market`）。
- `POST /registry/scan`：取包 + 扫描合一；返回 `verdict` / `findings` / `payload`。
- 解包安全：`bundle.materialize` 挡住路径逃逸与体积上限（默认 32MiB）。

明确不拥有：

- 技能落库、启用、分发到桌面（admin-console / iam-core）。
- 完整 `agx serve` / Studio 路由面（刻意不复用 `agenticx.studio.server`）。
- 模型调用（镜像只拷 `agenticx.skills` / `extensions` / `tools` / `core`，`--no-deps` 式裁剪）。

## Entry points and public interfaces

| 入口 | 路径 / 符号 | 角色 |
|------|-------------|------|
| App 工厂 | `skill_registry/app.py` — `create_app` | FastAPI；`docs_url=None` |
| 鉴权 | `require_internal_token` | Header `x-agx-internal-token`，`secrets.compare_digest` |
| 配置 | `skill_registry/config.py` — `Settings.from_env` | `SKILL_REGISTRY_INTERNAL_TOKEN` 或 `_FILE`；无 token **拒绝启动** |
| 解包 | `skill_registry/bundle.py` — `materialize` / `UnsafeBundleError` | 唯一接触不可信字节的层 |
| 取包 | `RegistryHub.from_config().fetch_skill_package` | source 默认 skillhub |
| 扫描 | `agenticx.skills.guard.scan_skill(..., source="community")` | 公网包按最低可信度 |
| 容器 | `Dockerfile` | python:3.12-slim，uid 10001，端口 **8090** |
| 本地 | `uvicorn skill_registry.app:create_app --factory --port 8090` | README |

## Core execution path

1. 编排器探 `/healthz`（无凭据）。
2. admin-console 持内部 token 调 `/registry/search` 或 `/registry/scan`。
3. scan：fetch → 临时目录 `materialize` → `scan_skill` → `scan_result_to_payload`；不安全包只返回 error，不给 verdict。
4. 调用方按 payload 决定是否写入企业技能库。

## Data and configuration

- 无数据库、无配置文件；全环境变量。
- `SKILL_REGISTRY_INTERNAL_TOKEN` / `_FILE`（必填）。
- `SKILL_REGISTRY_MAX_BUNDLE_BYTES`（默认 32MiB）。
- `SKILL_REGISTRY_FETCH_TIMEOUT_SECONDS`（默认 30）。
- 出网：`api.skillhub.cn` / `clawhub.ai`；受限网络须把 `RegistryHub` 源指到内网镜像。

## Dependencies

- **上游**：admin-console（`skill-registry-scan.ts`）及持内部 token 的编排。
- **下游**：`agenticx.extensions.registry_hub` / `skillhub_adapter`、`agenticx.skills.guard`。
- **不依赖**：PG/MySQL、LiteLLM、Studio。

## Tests and operations

- `enterprise/apps/skill-registry/tests/test_app.py`：健康检查、token、空 name、路径逃逸；不联网。
- 镜像 HEALTHCHECK 打本机 `/healthz`。
- 进程以非 root 跑；解包文件 `chmod 0o600`。

## Unverified or ambiguous

- 生产编排是否已把 8090 与 admin-console `SKILL_REGISTRY_*` 配齐：结论只核对本 app 源码，不核现场 env。
