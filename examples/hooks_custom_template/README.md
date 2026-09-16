# 自定义工作区钩子模板

一个可以直接照抄的最小钩子。把 `hooks/notify-on-new/` 整个目录复制到你自己的工作区
（`<workspace>/hooks/notify-on-new/`）即可。

```
hooks/
  notify-on-new/
    HOOK.yaml     # 元数据：名字、订阅的事件、入口函数名
    handler.py    # 实现：async def handle(event) -> bool | None
```

确认能被发现：

```python
from pathlib import Path
from agenticx.hooks.loader import discover_hooks

for entry in discover_hooks(Path("examples/hooks_custom_template")):
    print(entry.name, entry.source, entry.eligible)
```

要点：

- 一个目录必须同时有 `HOOK.yaml` 和 `handler.py` 才会被识别，少一个直接跳过。
- `HOOK.yaml` 的 `export` 指定入口函数名；入口必须是 async 的。
- `events` 写成 `"<type>:<action>"`；只写 `"<type>"` 表示订阅该类型的全部 action。
- 入口返回 `False` 表示否决。对 `before_tool_call` / `before_llm_call` 这类闸门事件，
  否决会拦下这次调用，并且**后面的钩子不再执行**；通知类事件则所有钩子都会收到。
- 同名钩子按 bundled → managed → workspace 的顺序覆盖，工作区里的优先级最高。
