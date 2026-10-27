# 托管运行时 agent-runtime

企业版托管会话的执行进程。它装配框架里的托管宿主：会话事件写入 PostgreSQL，Agent 与环境从管理台内部接口读取，调用方 PAT 经管理台内省，模型调用经企业网关。默认端口 **8092**。

## 职责

- 提供 `/ma/v1` 会话面：创建会话、追加事件、流式订阅。
- 把每个 `span.model_request_end` 记一行用量。
- 云端环境的工具在「每个会话一个私有工作目录 + 操作系统命令沙箱」里执行。
- 可选接线桌面 Worker 面（默认关闭）。

## 不负责

- 控制面资源（Agent、环境、密钥库）的增删改。那些请求由网关入口转到管理台。
- 每会话一个容器。
- 出站域名白名单由运行时执行，见下文「凭证与出站」。
- MySQL 存储、多副本、Worker 设备密钥校验。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 是 | — | `postgresql://` 或 `postgres://`。`mysql://` 拒绝启动。测试可设 `MA_RUNTIME_ALLOW_SQLITE=1` 后使用 `sqlite:///` |
| `DATABASE_DIALECT` | 否 | — | 若设置，只能是 `postgresql` |
| `MA_INTERNAL_TOKEN` / `MA_INTERNAL_TOKEN_FILE` | 是 | — | 调管理台内部接口的 Bearer。文件优先 |
| `MA_RUNTIME_ADMIN_URL` | 否 | `http://127.0.0.1:3001` | 管理台根地址，去掉尾部 `/` |
| `MA_RUNTIME_GATEWAY_URL` | 否 | `http://127.0.0.1:8088/v1` | 必须以 `/v1` 结尾 |
| `MA_RUNTIME_GATEWAY_TOKEN` / `MA_RUNTIME_GATEWAY_TOKEN_FILE` | 是 | — | 须以 `agx-pat-` 开头，scope 至少含 `workspace:chat` |
| `MA_RUNTIME_HOME` | 是 | — | 绝对路径。进程 `HOME` 必须指向同一目录 |
| `HOME` | 是 | — | 与 `MA_RUNTIME_HOME` 相同 |
| `MA_RUNTIME_REGISTRY_CACHE_SECONDS` | 否 | `10` | Agent / 环境缓存秒数，非法则回退默认 |
| `MA_RUNTIME_PAT_CACHE_SECONDS` | 否 | `30` | PAT 内省缓存，0–300，非法则回退默认 |
| `MA_RUNTIME_LLM_TIMEOUT_SECONDS` | 否 | `300` | 模型调用超时 |
| `MA_RUNTIME_COMMAND_SANDBOX` | 否 | `required` | `required` 或 `best_effort` |
| `MA_RUNTIME_DESKTOP_WORKER_ENABLED` | 否 | `0` | 仅 `1` 打开 Worker 面，并安装桌面领取授权（环境与 Agent 的执行名单、会话归属、租约用户） |
| `MA_RUNTIME_DESKTOP_PAT_ENABLED` | 否 | `0` | 仅 `1` 为真。为真时 `desktop:managed` PAT 映射 `ma:sessions:read`、`ma:sessions:write`、`ma:worker`，并限制桌面主体只能访问自己创建的会话 |
| `MA_RUNTIME_ELIGIBILITY_CACHE_SECONDS` | 否 | `30` | 用户可承接环境缓存秒数，浮点 0–300，非法回退默认 |
| `MA_RUNTIME_IMPLICIT_LOCAL_ENV` | 否 | `1` | 仅 `0` 关闭隐式云环境 |
| `MA_RUNTIME_INTERRUPT_GRACE_SECONDS` | 否 | `3` | 0.5–30 |
| `MA_RUNTIME_DB_POOL_SIZE` | 否 | `10` | 1–50 |
| `MA_RUNTIME_ALLOW_SQLITE` | 否 | `0` | 仅测试 |
| `MA_RUNTIME_CREDENTIALS_ENABLED` | 否 | `1` | 仅 `0` 为假。为假时不注册 Vault 校验，`vault_ids` 回到 400「not supported」；出站白名单仍生效 |
| `MA_RUNTIME_MEMORY_ENABLED` | 否 | `1` | 仅 `0` 为假。为假时不注册记忆挂载，`resources` 回到 400「not supported」 |
| `MA_RUNTIME_EGRESS_ENFORCE` | 否 | `1` | 仅 `0` 为假。为假时白名单只记录不拦截，bash 不断网，启动日志打 WARNING |
| `MA_RUNTIME_SCHEDULER_ENABLED` | 否 | `0` | 仅 `1` 开启定时任务 tick。每个副本都跑，靠运行行唯一键和 CAS 去重 |
| `MA_RUNTIME_SCHEDULER_TICK_SECONDS` | 否 | `15` | 5–300，非法回退默认 |
| `MA_RUNTIME_SCHEDULE_RUN_TIMEOUT_SECONDS` | 否 | `3600` | 60–86400，超时后中断会话并记 `failed/timeout` |
| `MA_RUNTIME_WEBHOOKS_ENABLED` | 否 | `0` | 仅 `1` 开启 Webhook 入队、投递和凭证到期扫描 |
| `MA_RUNTIME_WEBHOOK_MAX_ATTEMPTS` | 否 | `6` | 1–10 |
| `MA_WEBHOOK_ALLOW_LOOPBACK` | 否 | `0` | 仅 `1` 允许回环、链路本地和云元数据地址。默认拒绝 127.0.0.0/8、::1、169.254.0.0/16、fe80::/10 与云元数据 |
| `MA_WEBHOOK_BLOCK_PRIVATE` | 否 | `0` | 仅 `1` 额外拒绝 RFC1918 与 `http://`。默认允许内网地址和 `http://` |
| `MA_RUNTIME_WEBHOOK_CONFIG_CACHE_SECONDS` | 否 | `30` | 0–300，Webhook 配置（含签名密钥）内存缓存，不落盘 |
| `MA_RUNTIME_CHANNELS_ENABLED` | 否 | `0` | 仅 `1` 在持有 PG advisory lock 的单个副本上跑飞书长连接 |
| `MA_RUNTIME_CHANNEL_REPLY_TIMEOUT_SECONDS` | 否 | `300` | 10–1800，非法回退默认。超时后中断会话并回复超时说明 |
| `MA_RUNTIME_CHANNEL_MAX_CONCURRENCY` | 否 | `8` | 1–64 |
| `MA_RUNTIME_CHANNEL_RECONCILE_SECONDS` | 否 | `30` | 5–300，非法回退默认 |
| `MA_RUNTIME_CHANNEL_POLL_SECONDS` | 否 | `1` | 0.2–10，非法回退默认 |
| `MA_RUNTIME_CHANNEL_INBOUND_RETENTION_DAYS` | 否 | `7` | 1–90，入站去重表保留天数 |
| `MA_RUNTIME_AGENT_QUOTA_ENABLED` | 否 | `0` | 仅 `1` 才检查「用户 × 智能体」token 配额：云端会话每次模型请求前，以及所有会话（含桌面）每轮开始时 |
| `MA_RUNTIME_AGENT_QUOTA_CACHE_SECONDS` | 否 | `30` | 0–300，规则缓存秒数，非法回退默认 |
| `MA_RUNTIME_AGENT_QUOTA_STALE_SECONDS` | 否 | `600` | 0–3600，控制面失败时沿用最近一次成功结果的最长时间，非法回退默认 |
| `MA_QUOTA_TIMEZONE` | 否 | `Asia/Shanghai` | IANA 时区名。日、周（周一为首日）、月的边界按该时区计算，再换成 UTC 时间戳查询 `ma_session_usage`。管理台周期标签使用同一个变量。空值用默认。非法值拒绝启动 |
| `AGX_LEARNING_ENABLED` / `AGX_SESSION_FTS` / `AGX_SKILL_MANAGE` | 否 | `0` | 启动时补默认，关闭个人模式学习、全文索引和技能自建 |

## 本地运行

在仓库的 `enterprise/` 目录：

```bash
bash scripts/start-dev.sh --with-agent-runtime
```

不带该开关时，脚本不会启动本服务，也不会预置 PAT。进程 `HOME` 固定为 `enterprise/.runtime/agent-runtime/home`，不会读写开发者自己的 `~/.agenticx`。

健康检查：`http://127.0.0.1:8092/healthz`。

## 用户 × 智能体配额

`MA_RUNTIME_AGENT_QUOTA_ENABLED=1` 后，运行时在每次云端模型请求前、以及每个会话新的一轮开始前，按会话发起人与智能体核对日 / 周 / 月 token 上限。周期起算点来自 `MA_QUOTA_TIMEZONE`（默认 `Asia/Shanghai`），查询 `ma_session_usage` 时用对应的 UTC 时间戳。超限时本轮以 `stop_reason=budget_exceeded` 结束，并写入 `session.error.type=budget_exceeded`（`retry_status=terminal`）。控制面短暂不可用时放行，并在最长 10 分钟内沿用上一次成功读到的规则。开关为 `0` 时不包装模型工厂，也不包装执行器。

## 单测

```bash
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
```

PostgreSQL 契约（可选）：

```bash
MA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/agenticx \
  python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q -k pg
```

## 隔离边界

1. 每个会话有自己的工作目录。文件工具按该目录拒绝跨会话访问。
2. `bash_exec` 使用操作系统命令沙箱，权限固定为 `workspace-write`。Linux 需要可用的命令沙箱；macOS 使用系统自带的 `sandbox-exec`。
3. `MA_RUNTIME_COMMAND_SANDBOX=required`（容器默认）时，启动探测失败就拒绝启动。`best_effort` 只告警，此时 bash 没有操作系统隔离。
4. 环境配置里的 `sandbox_backend` 取 `subprocess` 或 `docker` 时，都按「运行时容器内 + 操作系统命令沙箱」执行。`remote` 在创建会话时返回 400。
5. 环境 `egress_allow_domains` 非空时，`web_fetch`（含重定向）和 MCP 连接按主机拦截，bash 断网。名单为空则不额外限制。

## 凭证与出站

cloud 会话可以带 `vault_ids`。调用方需要 `ma:vaults:read`（或 `ma:admin`）。`desktop_worker` 环境拒绝 `vault_ids`。

每个回合向管理台 `POST /api/internal/ma/vault-resolve` 解析当前值。MCP 按归一化后的 `mcp_server_url` 注入 `Authorization`。`environment_variable` 在命令沙箱里只放 `agxsec_` 占位值；明文只替换框架自己发出的 `web_fetch` URL 和 MCP 工具参数，且目标主机要命中该凭证的 `allowed_hosts`（或 `unrestricted`）。

bash 里拿着占位值去请求外部服务，对方收到的仍是占位值。环境白名单非空时 bash 没有网络。白名单非空但操作系统沙箱不可用时，bash 直接拒绝执行。

事件、预览帧和进程日志会把已知明文替换成 `[REDACTED:标签]`。短于 8 个字符的值不替换。

`MA_RUNTIME_CREDENTIALS_ENABLED=0` 关闭 Vault 校验。`MA_RUNTIME_EGRESS_ENFORCE=0` 让白名单只记日志、不拦截。

## 记忆挂载

cloud 会话可以带 `resources`，最多 8 个 `memory_store`。`read_only` 需要调用方具备 `ma:memory:read`、`ma:memory:write` 或 `ma:admin`；`read_write` 需要 `ma:memory:write` 或 `ma:admin`。`desktop_worker` 环境拒绝 `resources`。

每个回合开始，运行时向管理台拉取快照，把条目写成工作目录下的 `memory/<名称 slug>-<store id 末 6 位>/`。`file_write` / `file_edit` 命中可写挂载之后，以及回合结束时，把变化按 CAS 写回。冲突不覆盖远端内容：本会话的版本另存为 `<path>.conflict-<会话 id 末 8 位>`，并留下 `session.error`。只读挂载从不回写；本地改动在下一回合被快照覆盖，并留下 `memory_read_only_violation`。

`MA_RUNTIME_MEMORY_ENABLED=0` 关闭上述校验和挂载。已有会话的 `resources` 字段保留，但不再落盘。

## IM 渠道

`MA_RUNTIME_CHANNELS_ENABLED=1` 后，运行时拉取已启用的飞书渠道，每个渠道起一个子进程保持长连接。应用密钥不进数据库明文、进程参数或子进程环境变量，只经内部接口解析后从 stdin 交给子进程。渠道引用的 `environment_variable` 凭证建议单独建库；如果那个库也被会话的 `vault_ids` 引用，明文会按凭证的允许主机注入沙箱。

私聊按飞书 `open_id` 一个会话，群聊按 `chat_id` 整群一个会话。跟随最新时，Agent 的 `latest_version` 变化后下一条消息会新开会话。

## 单副本

会话状态机、事件广播和工作队列唤醒都在本进程内。部署固定 1 个副本。多副本需要会话亲和，当前不做。

## PAT

调用方令牌在管理台的 API 令牌页签发。本地开发也可以：

```bash
pnpm -C enterprise ma:provision-dev-tokens
```

这会在 `enterprise/.local-secrets/` 写入两个文件（已存在且以 `agx-pat-` 开头则跳过）：

- `ma_runtime_gateway.pat`：本服务调网关，scope `workspace:chat`
- `ma_portal_service.pat`：门户调本服务，scope `ma:sessions:read`、`ma:sessions:write`、`ma:sessions:on_behalf`、`ma:agents:read`

脚本不打印令牌明文。网关按服务令牌的属主记账；真实用户靠会话上的 `created_by_user_id` 关联。门户代表用户建会话时带 `X-AgenticX-On-Behalf-Of`，并且令牌含 `ma:sessions:on_behalf` 或 `ma:admin`。
