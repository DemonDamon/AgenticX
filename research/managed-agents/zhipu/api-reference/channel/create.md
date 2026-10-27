---
source: https://docs.bigmodel.cn/api-reference/channel/create
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Channel

> 创建飞书 Channel，将 Agent 绑定到飞书机器人。连接异步建立，创建后可查询连接状态。

<Accordion title="使用说明">

创建飞书 Channel。Caller 必须有目标 Agent 的 owner 权限，所有资源必须属于同一 customer。Agent ID 字符串或省略 version 时在创建时固定最新版本；template 不接受 Tools/MCP/Skills override。

owner 或资源预检调用失败时统一返回固定 500，且不创建 Channel。凭据已识别的鉴权拒绝返回 400；Provider 瞬态故障或并发预检忙返回 503。HTTP 201 只表示预检与保存成功；连接由后台异步建立，请读取 connection_status 与 last_error 判断状态。凭据不会回显。

完整配置 JSON 不得超过 65,535 UTF-8 字节。群聊模板必须包含两个占位符各一次。

</Accordion>



## OpenAPI

````yaml /openapi/openapi-channel.json post /agent/forward/v0/channels
openapi: 3.0.1
info:
  title: Channel API
  version: '2026-09-01'
  description: >-
    通过 Forward Channel
    服务接入聊天渠道。当前公开文档支持飞书；微信、企微等渠道近期支持。包含创建、列表、详情、群聊模板更新和删除。Channel v0 的服务地址与 Beta
    头独立于 Managed Agents v1。
servers:
  - url: https://agent-api.bigmodel.cn/api
    description: 生产环境（按账号开放）
  - url: https://dev-agent-api.bigmodel.cn/api
    description: 测试环境
security:
  - bearerAuth: []
tags:
  - name: Channel
    description: 渠道管理；Agent 运行仍通过 Managed Session 和 Events API。
paths:
  /agent/forward/v0/channels:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 生产环境
      - url: https://dev-agent-api.bigmodel.cn/api
        description: 测试环境
    post:
      tags:
        - Channel
      summary: 创建 Channel
      description: >-
        创建飞书 Channel，将 Agent 绑定到飞书机器人。连接异步建立，创建后可查询连接状态。


        <Accordion title="使用说明">


        创建飞书 Channel。Caller 必须有目标 Agent 的 owner 权限，所有资源必须属于同一 customer。Agent ID
        字符串或省略 version 时在创建时固定最新版本；template 不接受 Tools/MCP/Skills override。


        owner 或资源预检调用失败时统一返回固定 500，且不创建 Channel。凭据已识别的鉴权拒绝返回 400；Provider
        瞬态故障或并发预检忙返回 503。HTTP 201 只表示预检与保存成功；连接由后台异步建立，请读取 connection_status 与
        last_error 判断状态。凭据不会回显。


        完整配置 JSON 不得超过 65,535 UTF-8 字节。群聊模板必须包含两个占位符各一次。


        </Accordion>
      operationId: forwardPostChannels
      parameters:
        - $ref: '#/components/parameters/ForwardZaiVersion'
        - $ref: '#/components/parameters/ForwardZaiBeta'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ForwardChannelCreateRequest'
            example:
              channel_type: feishu
              name: Support Feishu channel
              template:
                agent:
                  type: agent
                  id: agent_01911111-1111-7111-8111-111111111111
                  version: 3
                environment_id: env_019e8f00-1ac2-7a6b-8000-3f2d5c8b9a01
              channel_config:
                credentials:
                  app_id: cli_xxx
                  app_secret: <app-secret>
      responses:
        '201':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForwardChannel'
              example:
                id: channel_xxx
                type: channel
                channel_type: feishu
                name: Support Feishu channel
                template:
                  agent:
                    type: agent
                    id: agent_xxx
                    version: 3
                  environment_id: env_xxx
                  vault_ids:
                    - vault_xxx
                  file_ids:
                    - file_xxx
                  memory_stores: []
                enabled: true
                binding_status: bound
                connection_status: disabled
                channel_config:
                  response_options:
                    include_tool_calls: false
                    include_process: false
                    card_output: true
                  group_prompt_template: null
                  private_memory_store_enabled: false
                last_error: null
                created_at: '2026-09-01T00:00:00.000Z'
                updated_at: '2026-09-01T00:00:00.000Z'
        '429':
          description: 当前 customer 或 Forward 全局限流。
          headers:
            Retry-After:
              schema:
                type: string
            x-ratelimit-scope:
              schema:
                type: string
                enum:
                  - global
              description: 仅全局 bucket 拒绝时出现。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForwardAgentErrorResponse'
        '503':
          description: '创建并发名额忙、依赖服务不可用或 Provider 瞬态错误；Retry-After: 1。'
          headers:
            Retry-After:
              schema:
                type: string
              description: 建议等待的秒数。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForwardAgentErrorResponse'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForwardAgentErrorResponse'
components:
  parameters:
    ForwardZaiVersion:
      name: zai-version
      in: header
      required: true
      description: Forward Channel v0 基础协议标识，当前固定为 2026-05-26。
      schema:
        type: string
        enum:
          - '2026-05-26'
        default: '2026-05-26'
        example: '2026-05-26'
    ForwardZaiBeta:
      name: zai-beta
      in: header
      required: true
      description: >-
        Channel v0 必须包含 managed-agents-2026-05-26；不要直接替换成 Managed API 推荐的新 Beta
        值。多个值用逗号分隔。
      schema:
        type: string
        default: managed-agents-2026-05-26
        example: managed-agents-2026-05-26
  schemas:
    ForwardChannelCreateRequest:
      type: object
      properties:
        channel_type:
          type: string
          enum:
            - feishu
          description: 当前公开接入使用 feishu；不要提前使用尚未公开开放的渠道类型。
        name:
          type: string
          minLength: 1
          maxLength: 128
          description: 必填；trim 后长度为 1–128。
          example: Support Feishu channel
        template:
          allOf:
            - $ref: '#/components/schemas/ForwardChannelTemplateInput'
          description: 收到消息后创建 Managed Session 所用的固定模板。
        channel_config:
          allOf:
            - $ref: '#/components/schemas/ForwardChannelConfigInput'
          description: 飞书凭据、输出选项、私有记忆和群聊 Prompt 模板。
      required:
        - channel_type
        - name
        - template
        - channel_config
      additionalProperties: false
      example:
        channel_type: feishu
        name: Support Feishu channel
        template:
          agent:
            type: agent
            id: agent_01911111-1111-7111-8111-111111111111
            version: 3
          environment_id: env_019e8f00-1ac2-7a6b-8000-3f2d5c8b9a01
        channel_config:
          credentials:
            app_id: cli_xxx
            app_secret: <app-secret>
          response_options:
            include_tool_calls: false
            include_process: false
            card_output: true
          private_memory_store_enabled: false
    ForwardChannel:
      type: object
      properties:
        id:
          type: string
          example: channel_xxx
        type:
          type: string
          enum:
            - channel
        channel_type:
          type: string
          enum:
            - feishu
          description: 当前对外文档开放飞书；微信、企微等渠道近期支持。
        name:
          type: string
          example: Support Feishu channel
        template:
          $ref: '#/components/schemas/ForwardChannelTemplate'
        enabled:
          type: boolean
          description: 新建 Channel 固定为 true。
          example: true
        binding_status:
          type: string
          description: Channel 绑定状态。
          example: bound
        connection_status:
          type: string
          description: 由取得 listener lease 的 Channel worker 异步推进。
          example: connected
        channel_config:
          $ref: '#/components/schemas/ForwardChannelConfig'
        last_error:
          type: object
          nullable: true
          additionalProperties: true
          example: null
        created_at:
          type: string
          format: date-time
          description: 创建时间。
        updated_at:
          type: string
          format: date-time
          description: 更新时间。
      required:
        - id
        - type
        - channel_type
        - name
        - template
        - enabled
        - binding_status
        - connection_status
        - channel_config
        - last_error
        - created_at
        - updated_at
      additionalProperties: false
      example:
        id: channel_xxx
        type: channel
        channel_type: feishu
        name: Support Feishu channel
        template:
          agent:
            type: agent
            id: agent_xxx
            version: 3
          environment_id: env_xxx
          vault_ids:
            - vault_xxx
          file_ids:
            - file_xxx
          memory_stores: []
        enabled: true
        binding_status: bound
        connection_status: connected
        channel_config:
          response_options:
            include_tool_calls: false
            include_process: false
            card_output: true
          group_prompt_template: null
          private_memory_store_enabled: false
        last_error: null
        created_at: '2026-09-01T00:00:00.000Z'
        updated_at: '2026-09-01T00:00:00.000Z'
    ForwardAgentErrorResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - error
        error:
          type: object
          properties:
            type:
              type: string
              enum:
                - authentication_error
                - permission_error
                - invalid_request_error
                - not_found_error
                - conflict_error
                - rate_limit_error
                - api_error
            message:
              type: string
            details:
              type: object
              additionalProperties: true
          required:
            - type
            - message
            - details
          additionalProperties: false
        request_id:
          type: string
          example: req_xxx
      required:
        - type
        - error
        - request_id
      additionalProperties: false
    ForwardChannelTemplateInput:
      type: object
      properties:
        agent:
          allOf:
            - $ref: '#/components/schemas/ForwardChannelAgentInput'
          description: Channel 使用的 Managed Agent；创建时固定版本。
        environment_id:
          type: string
          minLength: 1
          pattern: ^env_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
          description: 创建 Session 时使用的有效 Environment ID。
          example: env_019e8f00-1ac2-7a6b-8000-3f2d5c8b9a01
        vault_ids:
          type: array
          maxItems: 20
          uniqueItems: true
          default: []
          items:
            type: string
          description: 每个 Channel Session 挂载的 Vault ID；省略时为空，最多 20 个。
        file_ids:
          type: array
          maxItems: 20
          default: []
          items:
            type: string
          description: 创建 Channel 时复制到模板中的 File ID；省略时为空，最多 20 个。
        memory_stores:
          type: array
          items:
            $ref: '#/components/schemas/ForwardChannelMemoryStore'
          maxItems: 8
          description: 共享 Memory Store；ID 不可重复，与自动创建的私有 Store 合计最多挂载 8 个。
          default: []
      required:
        - agent
        - environment_id
      additionalProperties: false
      description: >-
        创建 Managed Session 的 inline 固定快照；不是可独立管理的 Template 实体，不接受 MCP、Tools 或
        Skills override。
    ForwardChannelConfigInput:
      type: object
      properties:
        credentials:
          $ref: '#/components/schemas/ForwardFeishuCredentials'
        response_options:
          $ref: '#/components/schemas/ForwardChannelResponseOptionsInput'
        private_memory_store_enabled:
          type: boolean
          default: false
          description: 是否为渠道私聊用户或群自动创建并挂载私有 Memory Store；创建后不能更新。
        group_prompt_template:
          type: string
          nullable: true
          maxLength: 4096
          description: >-
            群聊 Prompt 模板；{{context_note}} 与 {{messages}} 必须各出现一次。null
            使用默认模板；只影响新准备的群聊消息。
      additionalProperties: false
      required:
        - credentials
    ForwardChannelTemplate:
      type: object
      properties:
        agent:
          $ref: '#/components/schemas/ForwardChannelAgent'
        environment_id:
          type: string
          example: env_xxx
        vault_ids:
          type: array
          maxItems: 20
          items:
            type: string
          example:
            - vault_xxx
        file_ids:
          type: array
          maxItems: 20
          items:
            type: string
          example:
            - file_xxx
        memory_stores:
          type: array
          items:
            $ref: '#/components/schemas/ForwardChannelMemoryStore'
          maxItems: 8
          description: 共享 Memory Store；ID 不可重复，与自动创建的私有 Store 合计最多挂载 8 个。
      required:
        - agent
        - environment_id
        - vault_ids
        - file_ids
        - memory_stores
      additionalProperties: false
    ForwardChannelConfig:
      type: object
      properties:
        response_options:
          $ref: '#/components/schemas/ForwardChannelResponseOptions'
        private_memory_store_enabled:
          type: boolean
        group_prompt_template:
          type: string
          nullable: true
          maxLength: 4096
          description: >-
            群聊 Prompt 模板；{{context_note}} 与 {{messages}} 必须各出现一次。null
            使用默认模板；只影响新准备的群聊消息。
      additionalProperties: false
      required:
        - response_options
        - private_memory_store_enabled
        - group_prompt_template
    ForwardChannelAgentInput:
      oneOf:
        - type: string
          minLength: 1
          description: Agent ID；Create 会解析并固定当前版本。
          example: agent_01911111-1111-7111-8111-111111111111
        - type: object
          properties:
            type:
              type: string
              enum:
                - agent
            id:
              type: string
              minLength: 1
              description: 已存在且可访问的 Managed Agent ID。
              example: agent_01911111-1111-7111-8111-111111111111
            version:
              type: integer
              minimum: 1
              description: 可选；省略时固定当前 Agent version。
              example: 3
          required:
            - type
            - id
          additionalProperties: false
    ForwardChannelMemoryStore:
      type: object
      properties:
        memory_store_id:
          type: string
          minLength: 1
        access:
          type: string
          enum:
            - read_only
            - read_write
          default: read_write
      additionalProperties: false
      required:
        - memory_store_id
    ForwardFeishuCredentials:
      type: object
      properties:
        app_id:
          type: string
          minLength: 1
          description: 飞书自建应用的 App ID。
          example: cli_xxx
        app_secret:
          type: string
          minLength: 1
          writeOnly: true
          description: 飞书自建应用的 App Secret；仅写入，不在响应中返回。
          example: <app-secret>
      required:
        - app_id
        - app_secret
      additionalProperties: false
    ForwardChannelResponseOptionsInput:
      type: object
      properties:
        include_tool_calls:
          type: boolean
          default: false
          description: 执行中展示工具调用进度；不展示工具原始结果或 Thinking，终态移除过程面板。
        include_process:
          type: boolean
          default: false
          description: 执行中展示公开过程正文；不展示 Thinking，最终回复仍只使用当轮最后一条非空 agent.message。
        card_output:
          type: boolean
          default: true
          description: 飞书使用卡片输出；false 只发送最终普通文本，不展示过程或工具面板。
      additionalProperties: false
    ForwardChannelAgent:
      type: object
      properties:
        type:
          type: string
          enum:
            - agent
        id:
          type: string
          example: agent_xxx
        version:
          type: integer
          example: 3
      required:
        - type
        - id
        - version
      additionalProperties: false
    ForwardChannelResponseOptions:
      type: object
      properties:
        include_tool_calls:
          type: boolean
          default: false
          description: 执行中展示工具调用进度；不展示工具原始结果或 Thinking，终态移除过程面板。
        include_process:
          type: boolean
          default: false
          description: 执行中展示公开过程正文；不展示 Thinking，最终回复仍只使用当轮最后一条非空 agent.message。
        card_output:
          type: boolean
          default: true
          description: 飞书使用卡片输出；false 只发送最终普通文本，不展示过程或工具面板。
      additionalProperties: false
      required:
        - include_tool_calls
        - include_process
        - card_output
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.