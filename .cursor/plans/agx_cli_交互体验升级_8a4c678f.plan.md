---
name: AGX CLI 交互体验升级
overview: 升级 agx generate 和 agx studio 的交互体验：无参数时引导式输入、generate 支持 --interactive 多轮迭代、studio 全面升级、支持图片输入描述 UI 生成 Agent。
todos: []
isProject: true
phases:
  - name: Phase 1：generate 无参数引导 + --interactive 模式
    todos:
      - id: p1-t1
        content: generate_commands.py：DESCRIPTION 改为 Optional，缺失时用 typer.prompt() 引导输入，提示语为「请描述你想构建的 Agent / Workflow / Skill / Tool：」
        status: pending
      - id: p1-t2
        content: generate_commands.py：加 --interactive / -i flag；生成完毕后询问「是否继续修改？[y/n]」，y 则进入单 artifact 迭代循环，把上一版代码作为 context 传给 CodeGenEngine
        status: pending
      - id: p1-t3
        content: CodeGenEngine.generate()：context 支持 previous_code 字段；当 previous_code 非空时，system prompt 增加「以下是已有代码，请根据新需求修改：」段落
        status: pending
  - name: Phase 2：agx studio 体验全面升级
    todos:
      - id: p2-t1
        content: studio.py：启动时打印欢迎横幅 + 当前 provider/model，展示快捷命令表格（rich Table）
        status: pending
      - id: p2-t2
        content: studio.py：每次生成后自动 /show 最新代码（rich Syntax 高亮），并提示「输入修改需求继续迭代，/save 保存，/run 运行」
        status: pending
      - id: p2-t3
        content: studio.py：把历史对话（上下文）传入 CodeGenEngine，每轮都带着 previous_code + 本轮描述，让 LLM 做增量修改而非重新生成
        status: pending
      - id: p2-t4
        content: studio.py：/history 命令显示本次会话所有迭代记录（序号 + 描述 + 文件路径）
        status: pending
  - name: Phase 3：图片输入支持（多模态）
    todos:
      - id: p3-t1
        content: studio.py + generate_commands.py：支持 /image <path> 命令（studio）和 --image <path> 参数（generate）；读取图片并编码为 base64
        status: pending
      - id: p3-t2
        content: CodeGenEngine：当 context 含 image_b64 时，构建多模态 messages（content 为 list，含 text + image_url type）；仅对支持视觉的 provider 启用（openai gpt-4o / anthropic claude / volcengine doubao-vision）
        status: pending
      - id: p3-t3
        content: ProviderResolver / CodeGenEngine：增加 supports_vision() 方法，不支持时给出友好提示「当前模型不支持图片输入，请切换到 gpt-4o / claude-3 / doubao-vision」
        status: pending
---

# AGX CLI 交互体验升级

## 核心改动点

### Phase 1：generate 无参数引导 + --interactive 模式

`**agenticx/cli/generate_commands.py**`

- `DESCRIPTION` 从必填改为 `Optional`，缺失时 `typer.prompt()` 引导
- 加 `--interactive / -i` flag，生成后询问是否继续迭代
- 迭代时把上一版代码传入 `context["previous_code"]`

`**agenticx/cli/codegen_engine.py**`

- `generate()` 的 `context` 支持 `previous_code` 字段
- system prompt 增加「增量修改」段落

### Phase 2：studio 体验升级

`**agenticx/cli/studio.py**`

- 启动横幅改用 rich Panel + Table
- 每轮生成后自动展示 Syntax 高亮代码
- 历史上下文传入 LLM（增量修改）
- 新增 `/history` 命令

### Phase 3：图片输入（多模态）

`**agenticx/cli/generate_commands.py**` 加 `--image <path>`  
`**agenticx/cli/studio.py**` 加 `/image <path>` 命令  
`**agenticx/cli/codegen_engine.py**` 支持多模态 messages + `supports_vision()` 检测

## 关键文件

- `agenticx/cli/generate_commands.py`
- `agenticx/cli/studio.py`  
- `agenticx/cli/codegen_engine.py`

