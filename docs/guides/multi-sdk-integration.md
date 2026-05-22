# Connect Anthropic / Gemini / OpenAI SDKs to Enterprise Gateway

Point any official SDK at the gateway base URL and use PAT (`agx-pat-*`) or portal JWT as the API key.

## Anthropic Python SDK

```python
import os
import anthropic

client = anthropic.Anthropic(
    api_key=os.environ["AGX_PAT"],
    base_url="http://127.0.0.1:8088/v1",
)
msg = client.messages.create(
    model="deepseek-chat",
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello"}],
)
print(msg.content[0].text)
```

Streaming: pass `stream=True`; gateway returns Anthropic SSE events.

## Google GenAI (REST)

Configure custom endpoint to `http://127.0.0.1:8088` and call `v1beta/models/{model}:generateContent` with `Authorization: Bearer $AGX_PAT` (gateway accepts PAT on all routes).

## OpenAI Python SDK — Responses (minimal)

```python
import os
from openai import OpenAI

client = OpenAI(api_key=os.environ["AGX_PAT"], base_url="http://127.0.0.1:8088/v1")
resp = client.responses.create(model="gpt-4.1", input="Hello")
print(resp)
```

Note: `previous_response_id` multi-turn is not supported in this release.

## Reasoning models

Use suffixed model ids registered in admin, e.g. `gpt-5-high`, `claude-3-7-sonnet-thinking`. Gateway strips suffix and injects upstream reasoning/thinking parameters.

Made-with: Damon Li
