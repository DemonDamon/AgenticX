---
name: "enterprise-edge-https-nginx"
overview: "记录企业入口 HTTPS 握手失败的现象、根因证据链，以及将边缘 Nginx 切换为直接 TLS 终止的修复措施。"
todos: []
isProject: false
---

# 企业入口 HTTPS Nginx 终止配置修复

Planned-with: GPT-5.5
Suggested-Impl-Model: composer-2.5-fast

---

## 1. 背景

Desktop 用户账号设置里填写公网组织地址后，登录初始化失败。Desktop 侧当前会访问：

```text
POST <组织地址>/api/desktop/auth/device/init
```

该请求在发出 HTTP 前需要先完成 TLS 握手。现场排查时，客户端对公网 443 执行 TLS 探测得到：

```text
unexpected eof while reading
TLS connect error
```

该现象表示客户端发出 TLS ClientHello 后，对端直接关闭连接；不是正常的“证书已返回但域名不匹配”场景。正常证书问题通常至少会打印证书 subject / issuer / SAN，再给出 hostname mismatch、self-signed 或 unable to verify 等明确校验结果。

Desktop 当前将多类 SSL/TLS 异常统一映射为“HTTPS 证书无效或与域名不匹配”，因此用户看到的提示偏泛化，根因仍需以 `openssl` / `curl` 的 TLS 探测结果为准。

---

## 2. 现状证据链

### 2.1 Desktop 触发点

落点：`desktop/electron/main.ts` 的 `user-account-login-start` IPC handler。

关键行为：

```ts
const initResp = await proxyAwareFetch(`${baseUrl}/api/desktop/auth/device/init`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ deviceName: os.hostname() || DESKTOP_PRODUCT_LABEL }),
  signal: AbortSignal.timeout(ENTERPRISE_PORTAL_FETCH_TIMEOUT_MS),
});
```

若 TLS 握手失败，请求不会进入 web-portal 的业务路由。

### 2.2 当前 compose 挂载的是 HTTP-only Nginx 配置

落点：

- `enterprise/deploy/docker-compose/prod.yml`
- `enterprise/deploy/docker-compose/test.yml`

当前 nginx volume 形态为：

```yaml
volumes:
  - ../nginx/gateway.conf:/etc/nginx/nginx.conf:ro
  - ../nginx/certs:/etc/nginx/certs:ro
```

但 `enterprise/deploy/nginx/gateway.conf` 仅包含 HTTP 入口：

```nginx
server {
  listen 80;
  server_name _;
  # ...
}
```

因此即使 compose 暴露了 `443:443`，容器内 Nginx 也没有按该配置监听 `443 ssl`。

### 2.3 HTTPS 配置已存在但未被 compose 使用

落点：`enterprise/deploy/nginx/edge-split-https.conf`

该配置已经包含：

```nginx
server {
  listen 443 ssl http2;
  server_name <组织域名>;

  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  # ...
}
```

该配置还将 `/auth/desktop`、`/api/desktop/*` 等默认路径反代到 web-portal，方向正确。

### 2.4 证书包语义

证书包说明中明确：

- `*.pem` / `*.crt` / `*.cer`：用户证书，内容等价，可任选其一作为服务端证书。
- `*.key`：用户私钥，必须作为 `ssl_certificate_key` 使用。
- 若证书包提供 CA / 中间证书，应与用户证书拼成完整链供 `ssl_certificate` 使用。

注意：私钥不可提交到 git，也不要写入 plan、commit message、PR 正文或日志。

---

## 3. 根因判断

根因不是 Desktop 业务登录逻辑，也不是 web-portal 设备登录接口本身。

当前更符合以下部署配置问题：

1. 公网 443 未由有效 HTTPS listener 终止 TLS，导致 ClientHello 后连接被关闭。
2. compose 虽暴露 443，但 nginx 实际挂载的是 HTTP-only `gateway.conf`。
3. HTTPS 版 `edge-split-https.conf` 未接入 compose。
4. 证书文件尚未按 `fullchain.pem` / `privkey.pem` 或等价路径挂入 `/etc/nginx/certs`。

---

## 4. In Scope

- 将企业边缘 Nginx 切换为 HTTPS 入口配置。
- 明确证书与私钥在 Nginx 中的配置方式。
- 补充部署验证命令，确保 Desktop 再次配置组织地址前先验证公网 TLS 可用。
- 仅处理部署配置与运行手册层面的修复，不改 Desktop / web-portal / gateway 业务代码。

## 5. Out of Scope

- 不提交任何私钥、证书实体内容或生产凭据。
- 不修改 Desktop TLS 校验策略，不放宽证书校验。
- 不改变企业网关、策略、IAM、聊天业务语义。
- 不承诺 SLB / 防火墙 / DNS 由代码仓库自动配置，云资源仍需运维在控制台确认。

---

## 6. 修复措施

### 6.1 准备 Nginx 证书目录

在部署机上准备：

```bash
mkdir -p enterprise/deploy/nginx/certs
```

推荐使用当前 `edge-split-https.conf` 已约定的文件名：

```text
enterprise/deploy/nginx/certs/fullchain.pem
enterprise/deploy/nginx/certs/privkey.pem
```

生成规则：

```bash
# 若证书包提供中间 CA，则把“用户证书 + 中间 CA”合成为完整链。
cat "<用户证书>.pem" "<中间CA证书>.crt" > enterprise/deploy/nginx/certs/fullchain.pem

# 私钥只复制到部署机，不提交到仓库。
cp "<用户私钥>.key" enterprise/deploy/nginx/certs/privkey.pem
```

若没有中间 CA 文件，可先将用户证书复制为 `fullchain.pem`，但上线前必须用客户端验证证书链是否被信任。

### 6.2 挂载 HTTPS Nginx 配置

更新目标 compose 文件中的 nginx volumes：

```yaml
volumes:
  - ../nginx/edge-split-https.conf:/etc/nginx/nginx.conf:ro
  - ../nginx/certs:/etc/nginx/certs:ro
```

适用落点：

- `enterprise/deploy/docker-compose/prod.yml`
- 如测试环境也走同一 HTTPS 入口，则同步更新 `enterprise/deploy/docker-compose/test.yml`

### 6.3 校准 upstream 模式

`edge-split-https.conf` 当前是“边缘机反代到固定内网 IP”的形态：

```nginx
upstream agenticx_gateway {
  server <gateway-a-ip>:8088;
  server <gateway-b-ip>:8088;
}

upstream agenticx_portal {
  server <portal-a-ip>:3000;
  server <portal-b-ip>:3000;
}

upstream agenticx_admin {
  server <admin-a-ip>:3001;
  server <admin-b-ip>:3001;
}
```

如果实际部署是单机 docker compose 同网络运行，则应改为服务名：

```nginx
upstream agenticx_gateway {
  least_conn;
  server gateway-a:8088 max_fails=3 fail_timeout=10s;
  server gateway-b:8088 max_fails=3 fail_timeout=10s;
}

upstream agenticx_portal {
  server web-portal:3000;
}

upstream agenticx_admin {
  server admin-console:3001;
}
```

实施者必须按实际拓扑二选一，避免把边缘多机 IP 配置误用于单机 compose 网络。

### 6.4 设置公网 Base URL

若使用 `enterprise/deploy/docker-compose/prod.yml`，确保 web-portal 环境变量包含公网可访问地址：

```env
NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL=https://<组织域名>
```

该值不能写 docker service name，必须是员工 Desktop 能解析访问的公网 origin。

---

## 7. 验收标准

### AC1：Nginx 配置加载成功

在部署机执行：

```bash
docker exec agenticx-nginx-prod nginx -t
docker exec agenticx-nginx-prod nginx -T
```

验收点：

- `nginx -t` 成功。
- `nginx -T` 输出包含 `listen 443 ssl`。
- `nginx -T` 输出的 `ssl_certificate` 与 `ssl_certificate_key` 指向 `/etc/nginx/certs/` 下存在的文件。
- 当前加载配置为 `edge-split-https.conf` 等 HTTPS 配置，而不是 HTTP-only `gateway.conf`。

### AC2：公网 TLS 握手正常

在运行 Desktop 的同一类网络环境执行：

```bash
openssl s_client \
  -connect <组织域名>:443 \
  -servername <组织域名> \
  -verify_hostname <组织域名> \
  -brief </dev/null
```

验收点：

- 不再出现 `unexpected eof while reading`。
- 能看到服务端证书。
- 证书校验结果为 `Verification: OK`，或至少不再是握手阶段直接断开。
- 证书 SAN 覆盖目标组织域名；若使用通配符证书，应覆盖对应一级子域。

### AC3：HTTPS HTTP 层可访问

执行：

```bash
curl -Iv https://<组织域名>/
```

验收点：

- TLS 握手成功。
- HTTP 返回 `200`、`3xx` 或业务可解释状态，不再是 `curl: (35) TLS connect error`。

### AC4：Desktop 设备登录入口可达

执行：

```bash
curl -i \
  -X POST "https://<组织域名>/api/desktop/auth/device/init" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  --data '{"deviceName":"tls-smoke"}'
```

验收点：

- 请求进入 web-portal。
- 若数据库 / 登录配置完整，应返回包含 `deviceId`、`deviceSecret`、`verificationUrl` 的 JSON。
- 若业务配置不完整，也应返回 HTTP 层业务错误，而不是 TLS 错误。

### AC5：Desktop 用户账号设置通过

在 Desktop 用户账号设置中填写：

```text
https://<组织域名>
```

验收点：

- 不再出现“HTTPS 证书无效或与域名不匹配”。
- 能打开浏览器中的设备确认页，或进入后续企业登录流程。

---

## 8. 回滚方式

若 HTTPS 配置导致 Nginx 无法启动：

1. 将 compose nginx volume 临时切回 `../nginx/gateway.conf:/etc/nginx/nginx.conf:ro`。
2. 重启 nginx，使 HTTP 入口恢复。
3. 修正证书路径、私钥权限或 upstream 配置后，再切回 HTTPS 配置。

回滚只恢复入口层，不应改动数据库、gateway runtime volume 或应用镜像。

