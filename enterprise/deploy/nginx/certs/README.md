# Nginx TLS Certificates Directory

本目录由 `enterprise/deploy/docker-compose/prod.yml` 只读挂载到容器内 `/etc/nginx/certs`。

## 文件约定

启用 `gateway.tls.conf` 前，请将以下两个 PEM 文件放置在本目录（或通过自定义卷挂载到容器 `/etc/nginx/certs`）：

- `fullchain.pem`：服务器证书与中间证书链（PEM 格式）
- `privkey.pem`：对应的私钥文件（PEM 格式，宿主机权限建议 `chmod 600 privkey.pem`）

本目录的 `.gitignore` 已忽略 `*.pem` / `*.key` / `*.crt` 等证书文件，**切勿将生产私钥提交到 Git 仓库**。

## 启用 TLS

默认情况下，`prod.yml` 使用 `../nginx/gateway.conf`（纯 HTTP：Portal `:80`，Admin Console `:8081`），无需证书即可直接启动。

放置证书后，通过环境变量切换为 TLS 模板：

```bash
export NGINX_CONF_FILE=../nginx/gateway.tls.conf
export AUTH_COOKIE_SECURE=true
docker compose -f prod.yml --profile postgresql up -d --force-recreate nginx
```

启用后端口映射如下：

- `80` → 301 跳转 `443`（保留 `/healthz` 明文探针）
- `443` → Web Portal + AI Gateway (`/v1/*`, `/api/chat/*`, `/ma/v1/*`)
- `8081` → 301 跳转 `8443`
- `8443` → Admin Console 独立 HTTPS 入口

## 本地 / 测试环境自签证书示例

```bash
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout enterprise/deploy/nginx/certs/privkey.pem \
  -out enterprise/deploy/nginx/certs/fullchain.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
chmod 600 enterprise/deploy/nginx/certs/privkey.pem
```

如需独立域名（如 `portal.example.com` 与 `admin.example.com` 共用 443 端口），请使用通配符证书或多域名 SAN 证书，并在 `gateway.tls.conf` 中按 `server_name` 分流。
