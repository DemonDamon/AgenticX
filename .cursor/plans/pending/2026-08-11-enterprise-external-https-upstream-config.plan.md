# Enterprise 多实例部署 Nginx 负载均衡统一收口

Planned-with: claude-opus-4-20250514

## 背景与问题

Enterprise 多主机部署架构如下：

| 节点 | 角色 | 端口 |
|------|------|------|
| 192.168.16.66 / nginx | Nginx edge | 80, 443 |
| 192.168.16.66 / redis | Redis | 6379 |
| 192.168.16.66 / gateway-1 | Gateway | 8088 |
| 192.168.16.67 / gateway-2 | Gateway | 8088 |
| 192.168.16.68 / portal-1 | Web Portal | 3000 |
| 192.168.16.69 / portal-2 | Web Portal | 3000 |
| 192.168.16.70 / admin-1 | Admin Console | 3001 |
| 192.168.16.71 / admin-2 | Admin Console | 3001 |

**问题**：docker-compose overlay 配置文件和 `load-runtime-env.sh` 中，服务间调用直接指定实例 IP+端口（如 `192.168.16.70:3001`、`192.168.16.66:8088`），绕过了 nginx 负载均衡。当单实例故障时无法自动切换。

## 已实施的改动（2026-08-11）

### 1. `edge-split-https.conf` — Nginx 路由层

- 新增 port 80 内部 HTTP server 块（`server_name _; listen 80 default_server`），供服务间 HTTP 调用使用，不 301 到 HTTPS
- 新增 `/api/internal/` location → `agenticx_admin` upstream（HTTP + HTTPS 两处）
- 新增 port 3001 专用 server 块 → admin upstream（解决 Next.js 无 basePath 下 path prefix 路由失效问题）
- 新增 port 3000 专用 server 块 → portal upstream

### 2. `gateway.yml` — Gateway 拉取 Admin 内部 API

```
-  http://192.168.16.70:3001/api/internal/...
+  http://192.168.16.66/api/internal/...
```

### 3. `portal.yml` — Portal 调用 Gateway 模型推理

```
-  http://192.168.16.66:8088/v1/chat/completions
+  http://192.168.16.66/v1/chat/completions
```

### 4. `admin.yml` + `test.yml` — Admin 调用 Gateway

```
-  http://192.168.16.66:8088
+  http://192.168.16.66
```

### 5. `load-runtime-env.sh` — 统一环境变量默认值

所有 `GATEWAY_REMOTE_*_URL`、`GATEWAY_INTERNAL_*`、`GATEWAY_COMPLETIONS_URL`、`NEXT_PUBLIC_ADMIN_CONSOLE_URL`、`WEB_PORTAL_PUBLIC_BASE_URL` 均改为走 nginx。

## 路由端口矩阵（改后）

| nginx 端口 | 目标 upstream | 访问方式 |
|------------|--------------|---------|
| :80 | 按路径分发 | 服务间内部调用 by IP |
| :3001 | admin (70:3001 + 71:3001) | `http://192.168.16.66:3001/login` |
| :3000 | portal (68:3000 + 69:3000) | `http://192.168.16.66:3000/` |
| :443 | HTTPS 全路由 | 外部浏览器 by 域名 |

Port 80 路径分发规则：

| 路径 | upstream | 说明 |
|------|----------|------|
| `/v1/` | gateway (66:8088 + 67:8088) | 模型 API |
| `/api/internal/` | admin (70:3001 + 71:3001) | Gateway ↔ Admin 内部 API |
| `/api/chat/` | portal (68:3000 + 69:3000) | SSE 聊天流 |
| `/admin/` | admin (prefix strip) | 保留兼容 |
| `/` | portal | catch-all |

## 遗留/后续

- [ ] `NEXT_PUBLIC_ADMIN_CONSOLE_URL` 当前为 `http://192.168.16.66:3001`；若需 HTTPS 外网访问管理台，需配置 admin basePath 或独立子域名
- [ ] Redis 单实例（192.168.16.66:6379）无 LB 需求；若后续需 Redis HA，走 Sentinel/Cluster
- [ ] `nginx_test.yml` 已暴露 3000/3001 端口，实际部署 nginx 容器需确认防火墙放行

## 涉及文件

- `enterprise/deploy/nginx/edge-split-https.conf`
- `enterprise/deploy/docker-compose/gateway.yml`
- `enterprise/deploy/docker-compose/portal.yml`
- `enterprise/deploy/docker-compose/admin.yml`
- `enterprise/deploy/docker-compose/test.yml`
- `enterprise/deploy/docker-compose/nginx_test.yml`
- `enterprise/deploy/docker-compose/load-runtime-env.sh`

## In scope

- 服务间调用统一走 nginx 负载均衡
- nginx 新增内部 HTTP 路由 + 端口级 server 块

## Out of scope

- admin-console Next.js basePath 改造
- Redis HA / MySQL 读写分离代理
- HTTPS 证书续签或 HSTS 配置
- 应用层代码变更
