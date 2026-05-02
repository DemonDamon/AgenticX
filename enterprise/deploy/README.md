# Enterprise Deploy Notes (Hechuang)

## Production Template

- `docker-compose/dev.yml`：开发期基础依赖（Postgres + Redis）。
- `docker-compose/prod.yml`：生产模板（Nginx 入口 + 双网关 + 前后台 + PostgreSQL 主从 + Redis）。
- `nginx/gateway.conf`：公网入口反向代理与基础限流模板。
- `config/policies.yaml`：网关策略包装载清单（生产可按客户策略扩展）。

## Usage

```bash
cd enterprise/deploy/docker-compose
POSTGRES_PASSWORD=replace-me \
JWT_PUBLIC_KEY="$(cat /path/to/jwt.pub)" \
JWT_PRIVATE_KEY="$(cat /path/to/jwt.key)" \
docker compose -f prod.yml up -d
```

## Important

- `prod.yml` 为模板，不直接承诺客户侧最终网络拓扑；上云前按客户 VPC、WAF、证书体系做二次适配。
- PostgreSQL 主从复制参数（`wal_level`、`primary_conninfo` 等）由客户环境初始化脚本补齐。
