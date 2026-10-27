---
source: https://docs.bigmodel.cn/api-reference/channel/list
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Channel

> 分页列出当前账号的 Channel，返回安全配置，不回显凭据。

<Accordion title="使用说明">

按当前 customer 分页列出 Channel。返回安全的 resolved inline template 与 Channel 配置，不返回 credential、计费字段或内部 Identity/Session/binding 标识。

</Accordion>



## OpenAPI

````yaml /openapi/openapi-channel.json get /agent/forward/v0/channels
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
    get:
      tags:
        - Channel
      summary: 列出 Channel
      description: >-
        分页列出当前账号的 Channel，返回安全配置，不回显凭据。


        <Accordion title="使用说明">


        按当前 customer 分页列出 Channel。返回安全的 resolved inline template 与 Channel
        配置，不返回 credential、计费字段或内部 Identity/Session/binding 标识。


        </Accordion>
      operationId: forwardGetChannels
      parameters:
        - $ref: '#/components/parameters/ForwardZaiVersion'
        - $ref: '#/components/parameters/ForwardZaiBeta'
        - name: limit
          in: query
          required: false
          description: 每页数量。
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: order
          in: query
          required: false
          description: 排序方向。
          schema:
            type: string
            enum:
              - asc
              - desc
            default: desc
        - name: page
          in: query
          required: false
          description: 上一页返回的 opaque cursor。
          schema:
            type: string
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForwardChannelPage'
              example:
                data:
                  - id: channel_xxx
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
                next_page: null
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
    ForwardChannelPage:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ForwardChannel'
        next_page:
          type: string
          nullable: true
          description: 下一页 opaque cursor；没有下一页时为 null。
      required:
        - data
        - next_page
      additionalProperties: false
      example:
        data:
          - id: channel_xxx
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
        next_page: null
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