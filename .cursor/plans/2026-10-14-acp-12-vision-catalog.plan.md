# acp-12 看图判断共用一份目录

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

Python、桌面和门户聊天对同一批模型是否能看图给出相同结论。目录在 `agenticx/llms/vision_cases.json`。

## 落点

- `agenticx/llms/vision.py`：补上与桌面相同的纯文本模型匹配（如 gpt-3.5、embedding、whisper、deepseek-chat）。
- `enterprise/features/chat/src/utils/model-vision.ts`：按模型名判断，不再只在特定供应商下才拦截 glm / qwen，并补上 MiMo 与 GLM-5.3 例外。
- 三边测试都读同一份 JSON。

## AC

- `pytest tests/test_llm_vision.py -q --no-cov` 通过。
- `cd desktop && npx vitest run src/utils/model-vision.test.ts` 通过。
- `cd enterprise/features/chat && npx vitest run src/utils/model-vision.test.ts` 通过。
