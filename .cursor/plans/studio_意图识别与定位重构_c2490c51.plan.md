---
name: Studio 意图识别与定位重构
overview: 为 agx studio 增加意图识别层（区分闲聊/问答/代码生成），重新定义 studio 与 generate --interactive 的职责边界，让 studio 成为真正的对话式智能体构建助手。
todos: []
isProject: true
phases:
  - name: Phase 1：意图识别引擎
    todos:
      - id: p1-t1
        content: 新建 agenticx/cli/intent_classifier.py：定义 IntentType 枚举（GENERATE_CODE / MODIFY_CODE / CHAT / QUESTION / UNCLEAR），实现 classify_intent() 方法。采用两层策略：(1) 规则快筛 — /命令前缀、长度<6字且无关键词、问号结尾无代码关键词 → 快速分类；(2) 不确定时调 LLM 做轻量分类（单次短 prompt，不消耗多余 token）。
        status: pending
      - id: p1-t2
        content: intent_classifier.py：规则层关键词表 — 生成类（创建/生成/帮我做/build/create/实现/写一个/开发）、修改类（加一个/改一下/优化/修复/增加/删除/重构）、问答类（是什么/怎么/为什么/如何/能不能/支持吗/有没有）。规则命中 → 直接返回，不调 LLM。
        status: pending
      - id: p1-t3
        content: "intent_classifier.py：LLM 分类 prompt 设计 — system: '你是意图分类器，只输出一个词：GENERATE/MODIFY/CHAT/QUESTION/UNCLEAR'，user: '{input}'。解析返回值映射到 IntentType，超时/异常 fallback 到 UNCLEAR。"
        status: pending
  - name: Phase 2：Studio 对话模式
    todos:
      - id: p2-t1
        content: studio.py：主循环集成 intent_classifier。GENERATE_CODE → 走现有代码生成流程。MODIFY_CODE → 走增量修改流程（previous_code 必须存在，否则降级为 GENERATE_CODE）。CHAT/QUESTION → 调 LLM 直接对话回复（不生成代码），用 agenticx-quickstart 元 Skill 作为 system prompt 让 LLM 有 AgenticX 知识来回答。UNCLEAR → 先问用户'你是想让我生成代码，还是有问题要问？输入需求描述开始生成，或直接提问。'
        status: pending
      - id: p2-t2
        content: studio.py：新增 _chat_reply() 方法 — 用当前 provider 调 LLM，system prompt 为 agenticx-quickstart 元 Skill 内容 + '你是 AgenticX 助手，用中文回答用户关于 AgenticX 的问题。不要生成代码，除非用户明确要求。'，返回文本直接打印。
        status: pending
      - id: p2-t3
        content: "studio.py：对话历史管理 — 新增 chat_history: List[Dict] 字段到 StudioSession，CHAT/QUESTION 回复也记录进去。代码生成时不传 chat_history 给 CodeGenEngine（避免污染），但 _chat_reply 时带上最近 N 轮对话做上下文。"
        status: pending
  - name: Phase 3：Studio 与 generate --interactive 职责分离
    todos:
      - id: p3-t1
        content: 重新定义职责边界 — generate --interactive：目标锁定（agent/workflow/tool/skill），纯代码迭代，适合'我知道要什么、帮我改'的场景，无闲聊。studio：开放式助手，支持闲聊/问答/代码生成/修改，适合'我还没想好，帮我从0探索'的场景。更新 docs/cli.md 对应章节描述。
        status: pending
      - id: p3-t2
        content: studio.py 启动欢迎语增加引导 — 欢迎语改为：'直接描述需求生成代码，或提问了解 AgenticX 用法。' 让用户明确知道 studio 能对话。
        status: pending
      - id: p3-t3
        content: generate --interactive 保持现有行为不变（不加意图识别），只做纯代码迭代循环，确认与 studio 的差异化。
        status: pending
  - name: Phase 4：测试与验证
    todos:
      - id: p4-t1
        content: tests/test_intent_classifier.py：规则层测试 — '你是？' → CHAT，'帮我创建一个Agent' → GENERATE_CODE，'加一个搜索工具' → MODIFY_CODE，'AgenticX支持哪些LLM？' → QUESTION，空字符串 → UNCLEAR。
        status: pending
      - id: p4-t2
        content: tests/test_cli_studio.py：补测 studio 意图分流 — mock LLM，验证 CHAT 输入不触发 CodeGenEngine.generate()，GENERATE 输入触发 generate()。
        status: pending
---

# Studio 意图识别与定位重构

## 核心问题

当前 `agx studio` 把所有非 `/命令` 输入一律当作代码生成需求，导致"你是？"这种闲聊也触发了 agent 代码生成。同时 `studio` 和 `generate --interactive` 高度重叠，定位不清。

## 定位重新界定


| 维度    | `agx generate --interactive`     | `agx studio`                              |
| ----- | -------------------------------- | ----------------------------------------- |
| 用途    | 知道要什么，纯代码迭代                      | 从零探索，对话式构建                                |
| 目标类型  | 命令级锁定（agent/workflow/tool/skill） | 自动检测，可跨 target                            |
| 闲聊/问答 | 不支持，每轮必须是修改需求                    | 支持，能回答 AgenticX 用法问题                      |
| 意图识别  | 不需要                              | 需要（GENERATE/MODIFY/CHAT/QUESTION/UNCLEAR） |
| 上下文   | 仅 previous_code                  | previous_code + chat_history + image      |


## 意图识别架构

```
用户输入
  │
  ├── / 前缀 → 命令处理（现有逻辑）
  │
  └── 自然语言 → IntentClassifier
                    │
                    ├── 规则快筛（关键词 + 长度 + 句式）
                    │     命中 → 直接返回 IntentType
                    │
                    └── 不确定 → LLM 轻量分类（1次短调用）
                          │
                          ├── GENERATE_CODE → CodeGenEngine.generate()
                          ├── MODIFY_CODE  → CodeGenEngine.generate(previous_code=...)
                          ├── CHAT         → _chat_reply()（直接对话）
                          ├── QUESTION     → _chat_reply()（带元 Skill 知识）
                          └── UNCLEAR      → 引导提示
```

## 关键文件

- 新建 `agenticx/cli/intent_classifier.py`
- 修改 `agenticx/cli/studio.py`
- 修改 `docs/cli.md`（职责对比说明）
- 新建 `tests/test_intent_classifier.py`
- 更新 `tests/test_cli_studio.py`

## 设计要点

- 规则层覆盖 80%+ 场景，只在不确定时调 LLM（省 token）
- CHAT/QUESTION 回复用 agenticx-quickstart 元 Skill 作系统知识，让助手能回答框架问题
- 对话历史（chat_history）与代码上下文（previous_code）分离，互不污染
- `generate --interactive` 不改，保持纯代码迭代定位

