# agenticx-sdk (Python)

AgenticX Enterprise 的 Python 客户端 SDK，供后端服务/脚本/Machi 桌面端（Python 侧）调用。

## 安装

```bash
pip install -e packages/sdk-py
```

## Managed Agents

`agenticx_sdk.managed.ManagedAgentsClient` 调用公开的 `/ma/v1`。它不依赖 `agenticx` 包。生产环境把网关根地址传给 `base_url`；本地没有 nginx 时分开写控制面和会话面（控制面要带 `/api`）：

```python
from agenticx_sdk.managed import MAEndpoints, ManagedAgentsClient

endpoints = MAEndpoints.resolve(
    "http://127.0.0.1",
    control_url="http://127.0.0.1:3001/api",
    runtime_url="http://127.0.0.1:8092",
)
client = ManagedAgentsClient(endpoints, "agx-pat-...")
try:
    agents = client.list_agents()
    session = client.create_session({"agent_id": agents[0]["agent"]["id"]})
    for event in client.iter_events(session["id"], until_idle=True):
        print(event["seq"], event["type"])
finally:
    client.close()
```

令牌必须是 `agx-pat-` 开头的个人访问令牌。客户端不会把令牌写入异常文本或 `repr`。
