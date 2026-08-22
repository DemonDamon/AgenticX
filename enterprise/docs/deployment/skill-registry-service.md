# 新增组件：skill-registry（给运维的说明）

## 一句话

多一个容器，只做一件事：**管理员从技能市场引进新技能时，先把技能包下载下来扫一遍，
告诉后台"这东西安不安全"**。不装它，后台照常工作，只是管理员得手工填技能信息、且没有
安全扫描结论。

## 为什么不能在现有服务里做

扫描器本身有约 3000 行，查的是数据外泄、prompt 注入、破坏性操作、持久化这几类问题，
现有代码在 Python 侧，桌面端每天在用。后台是 Node，用 Node 重写一遍等于维护两个扫描器，
而企业侧那个必然更弱——偏偏它守的是全公司，桌面端那个只守一个人。

## 需要什么

| 项 | 值 |
|---|---|
| 镜像基础 | `python:3.12-slim` |
| Python 依赖 | 5 个：fastapi、uvicorn、httpx、PyYAML、pydantic |
| 镜像体积 | 百来 MB（**不装** litellm/openai/tokenizers 那一摞，它一次模型调用都不发） |
| 监听 | 容器内 `:8090`，只走内网，**不要暴露到公网** |
| 健康检查 | `GET /healthz`，不需要凭据 |
| 必需环境变量 | `SKILL_REGISTRY_INTERNAL_TOKEN`（或 `SKILL_REGISTRY_INTERNAL_TOKEN_FILE` 挂 secret 文件） |
| 数据库 | **不需要**，不要给它数据库凭据 |
| 出网 | 需要能访问 `api.skillhub.cn` / `clawhub.ai`，或改配置指向内网镜像站 |

没有 token 时服务拒绝启动，不会裸奔监听。

## 网络这条要提前问客户

这是整套部署里**第一个需要主动访问外部站点**的组件。网关连的是配置好的模型端点，
后台连的是数据库，都是已知对端；这个要去公网拉任意技能包。

内网隔离的客户很可能连不上，**导入功能会从第一天起就是坏的**。所以上线前要么开通到那两个
域名的出网，要么在配置里把注册表源换成内网镜像站。不要等上线后当故障排查。

## 挂了会怎样

管理员导入不了新技能。已经发下去的技能、能力包、模型、搜索、桌面端同步**全部不受影响**——
它不在任何请求的主链路上。

## compose 片段

```yaml
  skill-registry:
    image: ghcr.io/agenticx/enterprise-skill-registry:latest
    container_name: agenticx-skill-registry
    restart: unless-stopped
    environment:
      SKILL_REGISTRY_INTERNAL_TOKEN_FILE: /run/secrets/skill_registry_token
    secrets:
      - skill_registry_token
    networks:
      - agenticx-backbone
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/healthz').status==200 else 1)"]
      interval: 30s
      timeout: 5s
      retries: 3
```

后台侧加一个指向它的地址即可（同一张内网，用服务名 `http://skill-registry:8090`）。

源码与 Dockerfile 在 `enterprise/apps/skill-registry/`。
