# agenticx.memory

## MemoryManager

```python
from agenticx.memory import MemoryManager

memory = MemoryManager(backend="sqlite")  # or "redis", "postgresql"

memory.add("key fact", tags=["category"])
results = memory.search("query", top_k=5)
memory.get_core()
```

!!! tip "Full API Reference"
    See [source on GitHub](https://github.com/DemonDamon/AgenticX/tree/main/agenticx/memory).
