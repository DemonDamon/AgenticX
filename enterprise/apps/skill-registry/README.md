# skill-registry

企业侧技能注册服务。三个接口，没有第四个：

| 接口 | 作用 |
|---|---|
| `GET /healthz` | 探活，不需要 token |
| `GET /registry/search?q=` | 搜索注册表（skillhub / clawhub） |
| `POST /registry/scan` | 取包并扫描，返回 verdict 与命中项 |

## 为什么是独立服务而不是在 admin-console 里用 Node 重写

真正的载荷是扫描器，不是搜索。`agenticx.skills.guard` 那一套（guard_engine + 分类 +
评分 + 报告）查的是数据外泄、prompt 注入、破坏性操作、持久化。用 Node 再写一遍的结果是
两个扫描器，而企业侧那个必然是更弱的一个——偏偏它守的是全公司，桌面端那个只守一个人。

## 为什么不直接部署 agenticx.studio

`studio/server.py` 是 7900 行、133 个路由，含文件读写与会话操作。那是给桌面端本机用的，
跑在服务端等于把那一整片攻击面搬进内网。

## 它不该拿到的东西

**数据库凭据。** 这个服务只回答「这个技能是什么、扫出什么」，写库由 admin-console 做。
即使它被打穿，攻击者拿到的是一个出网能力，不是租户库。

## 取包与扫描为什么是同一个接口

拆开的话调用方就能拿到「已取回但没扫」的包，而那正是最该避免的中间态：企业侧是一个人
决定、全公司承受，不该存在跳过扫描的路径。

## 网络

它要出公网到 `api.skillhub.cn` / `clawhub.ai`。**受限网络的客户很可能连不上**——
注册表源是可配置的（`RegistryHub.from_config()`），现场应指向内网镜像站，
而不是等上线后才发现导入一直失败。

## 本地运行

```bash
SKILL_REGISTRY_INTERNAL_TOKEN=dev-token \
  uvicorn skill_registry.app:create_app --factory --port 8090
```

`SKILL_REGISTRY_INTERNAL_TOKEN_FILE` 同样有效（长随机串塞不进 .env）。
没有 token 时服务拒绝启动，不会裸奔监听。
