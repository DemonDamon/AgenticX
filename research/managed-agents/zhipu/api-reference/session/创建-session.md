---
source: https://docs.bigmodel.cn/api-reference/managed-agents--session/创建-session
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Session

> 基于指定 Agent 和 Environment 创建 Session。可选择固定 Agent 版本或提供会话级覆盖，并可附带初始用户消息、File 或 Memory Store 资源及 Vault。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/sessions
openapi: 3.0.1
info:
  title: 智谱 AI Managed Agents API
  version: 1.0.0
  description: Agent、Environment、Session、File、Memory、Vault、Skill、Deployment 接口。
  contact:
    name: Z.AI 开发者
    url: https://chat.z.ai/legal-agreement/privacy-policy
    email: user_feedback@z.ai
servers:
  - url: https://open.bigmodel.cn/api/
    description: 开放平台服务
security:
  - bearerAuth: []
tags:
  - name: Managed Agents - Agent
    description: Agent 与版本管理。
    x-group: Agent
  - name: Managed Agents - Environment
    description: 声明式执行环境管理。
    x-group: Environment
  - name: Managed Agents - Session
    description: Session、Resource 与事件流。
    x-group: Session
  - name: Managed Agents - File
    description: Managed Files 上传、读取与删除。
    x-group: File
  - name: Managed Agents - Memory
    description: Memory Store、Memory 与版本管理。
    x-group: Memory
  - name: Managed Agents - Vault
    description: Vault 与 Credential 管理。
    x-group: Vault
  - name: Managed Agents - Skill
    description: 自定义 Skill 与版本管理。
    x-group: Skill
  - name: Managed Agents - Deployment
    description: 定时或手动 Deployment 与运行记录。
    x-group: Deployment
  - name: Thread
    description: 会话线程
    x-group: Thread
paths:
  /agent/managed/v1/sessions:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - Session
      summary: 创建 Session
      description: >-
        基于指定 Agent 和 Environment 创建 Session。可选择固定 Agent
        版本或提供会话级覆盖，并可附带初始用户消息、File 或 Memory Store 资源及 Vault。
      operationId: managedPostSessions
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - $ref: '#/components/parameters/ManagedEventsEncrypted'
        - $ref: '#/components/parameters/ManagedCheckpoint'
        - $ref: '#/components/parameters/ManagedCheckpointTtl'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ManagedSessionCreateRequest'
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedSession'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedAgentsErrorResponse'
components:
  parameters:
    ManagedZaiVersion:
      name: zai-version
      in: header
      required: true
      description: >-
        Managed Agents API 入口要求的基础协议标识，当前只接受 2026-05-26；响应兼容形态由 zai-beta
        选择。两个头均需携带。
      schema:
        type: string
        enum:
          - '2026-05-26'
        default: '2026-05-26'
        example: '2026-05-26'
    ManagedZaiBeta:
      name: zai-beta
      in: header
      required: true
      description: >-
        声明 Managed Agents Beta 协议并选择响应字段与兼容行为。新接入使用
        managed-agents-2026-09-22；旧客户端仍可使用 managed-agents-2026-05-26。必须同时携带
        zai-version: 2026-05-26。字段差异见 /cn/managed-agents/protocol-versions。
      schema:
        type: string
        default: managed-agents-2026-09-22
        example: managed-agents-2026-09-22
    ManagedEventsEncrypted:
      name: x-events-encrypted
      in: header
      required: false
      description: >-
        仅创建 Session 时可用。精确传 true 时启用事件加密。详见
        [会话事件数据加密](/cn/managed-agents/events#会话事件数据加密)。
      schema:
        type: string
        enum:
          - 'true'
          - 'false'
        default: 'false'
    ManagedCheckpoint:
      name: x-checkpoint
      in: header
      required: false
      description: >-
        创建时固定。显式 true/false 优先；未声明时Multi Agent Agent
        列表/仓库资源可推导默认开启。成功或合作式中断收尾尽力保存，失败/配额不足可能回退，不保证唯一持久存储。
      schema:
        type: string
        enum:
          - 'true'
          - 'false'
    ManagedCheckpointTtl:
      name: x-checkpoint-ttl
      in: header
      required: false
      description: >-
        保留天数 1–30。通常须显式 x-checkpoint:true；仓库资源默认开启时也可设置；只依赖 Agent 列表 默认开启时单独 TTL
        仍被拒绝。
      schema:
        type: integer
        minimum: 1
        maximum: 30
        default: 30
  schemas:
    ManagedSessionCreateRequest:
      type: object
      properties:
        agent:
          allOf:
            - $ref: '#/components/schemas/ManagedSessionAgentInput'
          description: Agent 配置；必填。仅为兼容旧调用时可改用 agent_id。
        agent_id:
          type: string
          minLength: 1
          description: 兼容字段；agent 缺失时使用。
        environment_id:
          type: string
          minLength: 1
          maxLength: 64
          pattern: ^env_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
          description: 必填的 Environment ID；必须存在、未归档并可由当前 Agent 使用。
          example: env_019e8f00-1ac2-7a6b-8000-3f2d5c8b9a01
        title:
          type: string
          nullable: true
          maxLength: 256
          default: null
          description: 会话标题；省略或传 null 时不设置。
        metadata:
          $ref: '#/components/schemas/ManagedMetadata'
        initial_events:
          type: array
          maxItems: 50
          default: []
          description: >-
            创建后立即写入并唤醒执行的 user.message 事件；省略时为空。仅允许文本与图片（base64、url 或 file
            来源），图片要求生效模型支持图片输入。
          items:
            $ref: '#/components/schemas/ManagedInitialUserMessageEventInput'
        resources:
          type: array
          default: []
          description: >-
            file ≤500、memory_store ≤8；github_repository 只在创建 Session
            时声明。仓库凭据可轮换，不支持后续新增或删除仓库。
          items:
            $ref: '#/components/schemas/ManagedSessionResourceInput'
        vault_ids:
          type: array
          items:
            type: string
          maxItems: 20
          uniqueItems: true
          default: []
          description: 挂载的 Vault ID；省略时为空，最多 20 个且不得重复。
      required:
        - agent
        - environment_id
      description: 必须提供 agent 与 environment_id。未传 agent 时，服务端仍接受兼容字段 agent_id。
      anyOf:
        - title: agent
          required:
            - agent
        - title: agent_id
          required:
            - agent_id
    ManagedSession:
      type: object
      properties:
        id:
          type: string
          description: Session ID。
          example: sess_01J...
        type:
          type: string
          enum:
            - session
        agent:
          $ref: '#/components/schemas/ManagedSessionAgentResponse'
        environment_id:
          type: string
        status:
          type: string
          enum:
            - idle
            - running
            - rescheduling
            - terminated
        title:
          type: string
          nullable: true
          description: Session 标题。
        metadata:
          $ref: '#/components/schemas/ManagedMetadata'
        resources:
          type: array
          items:
            $ref: '#/components/schemas/ManagedSessionResourceResponse'
        vault_ids:
          type: array
          items:
            type: string
        outcome_evaluations:
          type: array
          items:
            type: object
            additionalProperties: true
        stats:
          type: object
          properties:
            active_seconds:
              type: number
            duration_seconds:
              type: number
          required:
            - duration_seconds
        usage:
          type: object
          properties:
            input_tokens:
              type: integer
            output_tokens:
              type: integer
            cache_read_input_tokens:
              type: integer
            server_tool_use:
              type: object
              properties:
                web_search_requests:
                  type: integer
                  minimum: 0
                web_fetch_requests:
                  type: integer
                  enum:
                    - 0
              required:
                - web_search_requests
                - web_fetch_requests
              additionalProperties: false
          required:
            - input_tokens
            - output_tokens
            - cache_read_input_tokens
        budget:
          type: object
          nullable: true
          enum:
            - null
          description: 当前不支持会话级消费上限，固定为 null。
        created_at:
          type: string
          format: date-time
          description: 创建时间。
        updated_at:
          type: string
          format: date-time
          description: 更新时间。
        archived_at:
          type: string
          nullable: true
          description: 归档时间。
      required:
        - id
        - type
        - agent
        - environment_id
        - status
        - title
        - metadata
        - resources
        - outcome_evaluations
        - stats
        - usage
        - vault_ids
        - created_at
        - updated_at
        - archived_at
      additionalProperties: false
    ManagedAgentsErrorResponse:
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
                - invalid_request_error
                - authentication_error
                - permission_error
                - not_found_error
                - request_too_large
                - rate_limit_error
                - api_error
                - timeout_error
                - overloaded_error
                - memory_path_conflict_error
                - memory_precondition_failed_error
                - conflict_error
            message:
              type: string
            details:
              type: object
              additionalProperties: true
          required:
            - type
            - message
          additionalProperties: false
        request_id:
          type: string
          example: req_01J...
      required:
        - type
        - error
        - request_id
      additionalProperties: false
    ManagedSessionAgentInput:
      oneOf:
        - title: Agent ID
          type: string
          minLength: 1
        - title: agent
          allOf:
            - $ref: '#/components/schemas/ManagedAgentReferenceInput'
        - title: agent_with_overrides
          allOf:
            - $ref: '#/components/schemas/ManagedAgentWithOverridesInput'
      description: 可传 Agent ID 字符串、固定版本引用，或带会话级覆盖的 Agent 引用。
    ManagedMetadata:
      type: object
      additionalProperties:
        type: string
      description: 客户端自定义元数据；省略时默认为空对象。最多 16 个键，键名长度不超过 64 字符，值必须是长度不超过 512 字符的字符串。
      maxProperties: 16
    ManagedInitialUserMessageEventInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - user.message
          description: 固定为 user.message。
        content:
          type: array
          minItems: 1
          description: 非空内容块数组；初始消息允许 text/image，普通消息还允许 document。图片最多 50 张；总量受请求体限制。
          items:
            $ref: '#/components/schemas/ManagedInitialContentBlock'
      required:
        - type
        - content
    ManagedSessionResourceInput:
      oneOf:
        - title: memory_store
          allOf:
            - $ref: '#/components/schemas/ManagedMemoryStoreResourceInput'
        - title: file
          allOf:
            - $ref: '#/components/schemas/ManagedFileResourceInput'
        - $ref: '#/components/schemas/ManagedGithubRepositoryInput'
          title: github_repository
    ManagedSessionAgentResponse:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum:
            - agent
        name:
          type: string
        model:
          $ref: '#/components/schemas/ManagedModelResponse'
        system:
          type: string
          nullable: true
          description: 解析后的系统提示词。
        description:
          type: string
          nullable: true
          description: Agent 描述。
        tools:
          type: array
          items:
            $ref: '#/components/schemas/ManagedAgentToolsetResponse'
        skills:
          type: array
          items:
            $ref: '#/components/schemas/ManagedSkillReference'
        mcp_servers:
          type: array
          items:
            $ref: '#/components/schemas/ManagedMcpServer'
        multiagent:
          type: object
          nullable: true
          enum:
            - null
          description: Session 内嵌快照当前为 null，成员 Agent 列表 从对应 Agent 版本读取。
        version:
          type: integer
          minimum: 0
      required:
        - id
        - type
        - name
        - model
        - system
        - description
        - tools
        - skills
        - mcp_servers
        - version
      additionalProperties: false
    ManagedSessionResourceResponse:
      oneOf:
        - title: memory_store
          allOf:
            - $ref: '#/components/schemas/ManagedMemoryStoreResourceResponse'
        - title: file
          allOf:
            - $ref: '#/components/schemas/ManagedFileResourceResponse'
        - $ref: '#/components/schemas/ManagedGithubRepositoryResponse'
          title: github_repository
    ManagedAgentReferenceInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - agent
          description: 固定为 agent。
        id:
          type: string
          minLength: 1
          description: Agent ID。
        version:
          type: integer
          minimum: 1
          description: 固定使用的 Agent 版本；省略时固定创建请求时的当前版本。
      required:
        - type
        - id
    ManagedAgentWithOverridesInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - agent_with_overrides
          description: 固定为 agent_with_overrides。
        id:
          type: string
          minLength: 1
          description: Agent ID。
        version:
          type: integer
          minimum: 1
          description: 基准 Agent 版本；省略时固定创建请求时的当前版本。
        model:
          allOf:
            - $ref: '#/components/schemas/ManagedModelInput'
          description: 覆盖完整模型配置；省略时继承 Agent 版本。
        system:
          type: string
          nullable: true
          maxLength: 100000
          description: 覆盖系统提示词；null 表示清空，省略时继承 Agent 版本。
        tools:
          type: array
          nullable: true
          maxItems: 128
          description: 整体覆盖工具列表；null 或空数组表示清空，省略时继承 Agent 版本。MCP 映射约束在合并后的最终配置上校验。
          items:
            $ref: '#/components/schemas/ManagedAgentToolsetInput'
        skills:
          type: array
          nullable: true
          maxItems: 20
          uniqueItems: true
          description: >-
            整体覆盖 Skill 列表；null 或空数组表示清空，省略时继承 Agent 版本。最终配置含 Skill 时必须含
            agent_toolset_20260601。
          items:
            $ref: '#/components/schemas/ManagedSkillReference'
        mcp_servers:
          type: array
          nullable: true
          maxItems: 20
          description: >-
            整体覆盖 MCP Server；null 或空数组表示清空，省略时继承 Agent 版本。最终配置必须与 mcp_toolset
            一一对应。
          items:
            $ref: '#/components/schemas/ManagedMcpServer'
      required:
        - type
        - id
      additionalProperties: false
    ManagedInitialContentBlock:
      oneOf:
        - title: text
          allOf:
            - $ref: '#/components/schemas/ManagedTextBlock'
        - title: image
          allOf:
            - $ref: '#/components/schemas/ManagedImageBlock'
    ManagedMemoryStoreResourceInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - memory_store
          description: 固定为 memory_store。
        memory_store_id:
          type: string
          minLength: 1
          description: 已存在且可访问的 Memory Store ID。
        access:
          type: string
          nullable: true
          enum:
            - read_only
            - read_write
          default: read_write
          description: 挂载权限；省略或传 null 时由 Memory 服务按 read_write 处理。
        instructions:
          type: string
          nullable: true
          maxLength: 4096
          description: 提供给 Agent 的使用说明；省略或传 null 时不设置。
      required:
        - type
        - memory_store_id
    ManagedFileResourceInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - file
          description: 固定为 file。
        file_id:
          type: string
          minLength: 1
          description: 已存在且归当前资源所有者所有的 File ID。
        mount_path:
          type: string
          nullable: true
          description: >-
            沙箱内挂载路径；省略或传 null 时默认为 /mnt/session/uploads/{file_id}。路径会归一化到
            /mnt/session/uploads 下，不能逃逸该目录，UTF-8 总长度不超过 1024 字节。
      required:
        - type
        - file_id
      additionalProperties: false
    ManagedGithubRepositoryInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - github_repository
        url:
          type: string
          maxLength: 2048
          pattern: ^https://github.com/[^/]+/[^/]+$
          description: 不含 .git 后缀
        authorization_token:
          type: string
          minLength: 1
          maxLength: 4096
          writeOnly: true
        mount_path:
          type: string
          maxLength: 4096
          nullable: true
          description: 在 /workspace 下，默认 /workspace/仓库名
        checkout:
          $ref: '#/components/schemas/ManagedRepositoryCheckout'
      required:
        - type
        - url
        - authorization_token
      additionalProperties: false
    ManagedModelResponse:
      type: object
      properties:
        id:
          type: string
          example: glm-5.3
        effort:
          oneOf:
            - type: object
              properties:
                type:
                  type: string
                  enum:
                    - low
                    - high
                    - max
              required:
                - type
              additionalProperties: false
            - type: string
              enum:
                - low
                - high
                - max
          description: 新协议返回 {type:档位}，旧协议返回字符串。
        speed:
          type: string
          enum:
            - standard
          example: standard
      required:
        - id
        - speed
      additionalProperties: false
    ManagedAgentToolsetResponse:
      oneOf:
        - title: agent_toolset_20260601
          type: object
          properties:
            type:
              type: string
              enum:
                - agent_toolset_20260601
            default_config:
              $ref: '#/components/schemas/ManagedToolDefaultConfigResponse'
            configs:
              type: array
              items:
                $ref: '#/components/schemas/ManagedBuiltinToolConfigResponse'
          required:
            - type
            - default_config
            - configs
          additionalProperties: false
        - title: mcp_toolset
          type: object
          properties:
            type:
              type: string
              enum:
                - mcp_toolset
            mcp_server_name:
              type: string
            default_config:
              $ref: '#/components/schemas/ManagedToolDefaultConfigResponse'
            configs:
              type: array
              items:
                $ref: '#/components/schemas/ManagedMcpToolConfigResponse'
          required:
            - type
            - mcp_server_name
            - default_config
            - configs
          additionalProperties: false
        - title: custom
          type: object
          properties:
            type:
              type: string
              enum:
                - custom
            name:
              type: string
            description:
              type: string
            input_schema:
              $ref: '#/components/schemas/ManagedCustomToolInputSchema'
          required:
            - type
            - name
            - description
            - input_schema
          additionalProperties: false
    ManagedSkillReference:
      type: object
      properties:
        type:
          type: string
          enum:
            - custom
            - zai
          description: custom 表示当前所有者创建的 Skill；zai 表示平台内置 Skill。
        skill_id:
          type: string
          minLength: 1
          description: Skill ID；必须存在且当前身份可访问。
        version:
          type: string
          minLength: 1
          description: >-
            可省略/null/latest。新协议在 Session 创建/Deployment 触发时固定，旧协议每次沙箱启动解析；具体 ID
            固定对应版本。
          nullable: true
          example: latest
      required:
        - type
        - skill_id
      additionalProperties: false
    ManagedMcpServer:
      type: object
      description: >-
        远程 MCP Server。name 在同一配置内必须唯一，并且必须与 tools 中恰好一个
        mcp_toolset.mcp_server_name 相同。
      properties:
        type:
          type: string
          enum:
            - url
          description: 当前只支持 url。
        name:
          type: string
          minLength: 1
          maxLength: 255
          description: Server 名称，长度 1–255；同一 mcp_servers 数组内不得重复。
        url:
          type: string
          format: uri
          pattern: ^https://
          maxLength: 2048
          description: 公开 HTTPS Streamable HTTP URL；不得包含凭据、fragment、空 query 或旧式 SSE 路径。
      required:
        - type
        - name
        - url
      additionalProperties: false
      example:
        type: url
        name: knowledge-base
        url: https://mcp.example.com/mcp
    ManagedMemoryStoreResourceResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - memory_store
        memory_store_id:
          type: string
        name:
          type: string
        description:
          type: string
          nullable: true
        access:
          type: string
          enum:
            - read_only
            - read_write
        instructions:
          type: string
          nullable: true
        mount_path:
          type: string
      required:
        - type
        - memory_store_id
        - name
        - description
        - access
        - instructions
        - mount_path
      additionalProperties: false
    ManagedFileResourceResponse:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum:
            - file
        file_id:
          type: string
        mount_path:
          type: string
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
        - file_id
        - mount_path
        - created_at
        - updated_at
      additionalProperties: false
    ManagedGithubRepositoryResponse:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum:
            - github_repository
        url:
          type: string
        mount_path:
          type: string
        checkout:
          $ref: '#/components/schemas/ManagedRepositoryCheckout'
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time
      required:
        - id
        - type
        - url
        - mount_path
        - created_at
        - updated_at
      additionalProperties: false
    ManagedModelInput:
      title: Managed Agents 模型
      example: glm-5.3
      default: glm-5.3
      oneOf:
        - title: 模型 ID
          type: string
          enum:
            - glm-5.3
            - glm-5.3-flash
            - glm-5.3-flashx
          example: glm-5.3
          default: glm-5.3
        - title: 模型配置
          type: object
          properties:
            id:
              type: string
              enum:
                - glm-5.3
                - glm-5.3-flash
                - glm-5.3-flashx
              example: glm-5.3
              default: glm-5.3
            effort:
              oneOf:
                - type: string
                  enum:
                    - low
                    - high
                    - max
                - type: object
                  properties:
                    type:
                      type: string
                      enum:
                        - low
                        - high
                        - max
                  required:
                    - type
                  additionalProperties: false
              nullable: true
              description: 输入兼容字符串/对象/null；glm-5.3 默认 max，flash/flashx 默认 high。
            speed:
              type: string
              nullable: true
              enum:
                - standard
              default: standard
              description: 当前仅支持 standard；省略或传 null 时也使用 standard。
          required:
            - id
          additionalProperties: false
      description: >-
        模型 ID，或包含推理强度与速度的模型配置。当前支持 glm-5.3、glm-5.3-flash 与
        glm-5.3-flashx。使用字符串简写时，服务端按模型补齐默认 effort，并将 speed 补为 standard。
    ManagedAgentToolsetInput:
      oneOf:
        - title: agent_toolset_20260601
          type: object
          properties:
            type:
              type: string
              enum:
                - agent_toolset_20260601
            default_config:
              allOf:
                - $ref: '#/components/schemas/ManagedToolDefaultConfigInput'
              nullable: true
              default: null
              description: 工具集默认配置；省略或传 null 时 enabled=true、permission_policy=always_allow。
            configs:
              type: array
              maxItems: 128
              default: []
              description: 逐工具覆盖；省略时为空，name 不得重复。
              items:
                $ref: '#/components/schemas/ManagedBuiltinToolConfigInput'
          required:
            - type
          additionalProperties: false
        - title: mcp_toolset
          type: object
          properties:
            type:
              type: string
              enum:
                - mcp_toolset
            mcp_server_name:
              type: string
              minLength: 1
              description: 必须精确匹配 mcp_servers 中唯一一个 Server 的 name。
            default_config:
              allOf:
                - $ref: '#/components/schemas/ManagedToolDefaultConfigInput'
              nullable: true
              default: null
              description: >-
                MCP 工具集默认配置；省略或传 null 时
                enabled=true、permission_policy=always_allow。
            configs:
              type: array
              maxItems: 128
              default: []
              description: 逐 MCP 工具覆盖；省略时为空，name 不得重复。
              items:
                $ref: '#/components/schemas/ManagedMcpToolConfigInput'
          required:
            - type
            - mcp_server_name
          additionalProperties: false
        - title: custom
          type: object
          properties:
            type:
              type: string
              enum:
                - custom
            name:
              type: string
              minLength: 1
              maxLength: 128
              pattern: ^[A-Za-z0-9_-]+$
              description: 自定义工具名；仅允许字母、数字、下划线和连字符，不得以 mcp__ 开头，且同一配置内不得重复。
            description:
              type: string
              minLength: 1
              maxLength: 4096
            input_schema:
              $ref: '#/components/schemas/ManagedCustomToolInputSchema'
          required:
            - type
            - name
            - description
            - input_schema
          additionalProperties: false
    ManagedTextBlock:
      type: object
      properties:
        type:
          type: string
          enum:
            - text
          description: 固定为 text。
        text:
          type: string
          minLength: 1
          description: 非空文本内容。
      required:
        - type
        - text
    ManagedImageBlock:
      type: object
      properties:
        type:
          type: string
          enum:
            - image
          description: 固定为 image。
        source:
          allOf:
            - $ref: '#/components/schemas/ManagedImageSource'
          description: base64、HTTPS URL 或 File ID 图片来源，需使用支持图片输入的模型。
      required:
        - type
        - source
      additionalProperties: false
    ManagedRepositoryCheckout:
      oneOf:
        - type: object
          properties:
            type:
              type: string
              enum:
                - branch
            name:
              type: string
              minLength: 1
              maxLength: 255
          required:
            - type
            - name
          additionalProperties: false
          title: 分支
        - type: object
          properties:
            type:
              type: string
              enum:
                - commit
            sha:
              type: string
              minLength: 6
              pattern: ^[0-9a-fA-F]+$
          required:
            - type
            - sha
          additionalProperties: false
          title: Commit
      nullable: true
    ManagedToolDefaultConfigResponse:
      type: object
      properties:
        enabled:
          type: boolean
        permission_policy:
          $ref: '#/components/schemas/ManagedPermissionPolicy'
      required:
        - enabled
        - permission_policy
      additionalProperties: false
    ManagedBuiltinToolConfigResponse:
      oneOf:
        - type: object
          properties:
            name:
              type: string
              enum:
                - read
                - write
                - edit
                - bash
                - grep
                - find
                - ls
            enabled:
              type: boolean
            permission_policy:
              $ref: '#/components/schemas/ManagedPermissionPolicy'
            type:
              type: string
              enum:
                - read
                - write
                - edit
                - bash
                - grep
                - find
                - ls
          required:
            - name
            - enabled
            - permission_policy
            - type
          additionalProperties: false
          title: 沙箱工具
          description: type/name 若同时提供必须相等。
        - type: object
          properties:
            name:
              type: string
              enum:
                - web_search
            enabled:
              type: boolean
            permission_policy:
              $ref: '#/components/schemas/ManagedPermissionPolicy'
            type:
              type: string
              enum:
                - web_search
            user_location:
              type: object
              properties:
                type:
                  type: string
                  enum:
                    - approximate
                city:
                  type: string
                  maxLength: 255
                region:
                  type: string
                  maxLength: 255
                country:
                  type: string
                  pattern: ^[A-Z]{2}$
                timezone:
                  type: string
              required:
                - type
              additionalProperties: false
              nullable: true
          required:
            - name
            - enabled
            - permission_policy
            - type
          additionalProperties: false
          title: web_search
          description: allowed_domains/blocked_domains 暂不接受：配置时 400，不是静默失效。
        - type: object
          properties:
            name:
              type: string
              enum:
                - web_fetch
            enabled:
              type: boolean
            permission_policy:
              $ref: '#/components/schemas/ManagedPermissionPolicy'
            type:
              type: string
              enum:
                - web_fetch
            max_content_tokens:
              type: integer
              minimum: 1
              nullable: true
            url_sources:
              type: object
              nullable: true
              enum:
                - null
              description: 新协议恒为 null；目前不接受对应输入配置。
          required:
            - name
            - enabled
            - permission_policy
            - type
          additionalProperties: false
          title: web_fetch
          description: allowed_domains/blocked_domains 暂不接受：配置时 400，不是静默失效。
    ManagedMcpToolConfigResponse:
      type: object
      properties:
        name:
          type: string
        enabled:
          type: boolean
        permission_policy:
          $ref: '#/components/schemas/ManagedPermissionPolicy'
      required:
        - name
        - enabled
        - permission_policy
      additionalProperties: false
    ManagedCustomToolInputSchema:
      type: object
      properties:
        type:
          type: string
          enum:
            - object
          description: 固定为 object。
        properties:
          type: object
          additionalProperties: true
          description: 工具输入字段的 JSON Schema；省略时表示未声明属性。
        required:
          type: array
          items:
            type: string
          description: 必填输入字段名；省略时无必填字段。
      required:
        - type
      additionalProperties: true
    ManagedToolDefaultConfigInput:
      type: object
      properties:
        enabled:
          type: boolean
          nullable: true
          default: true
          description: 工具集默认是否启用；省略或传 null 时为 true。
        permission_policy:
          allOf:
            - $ref: '#/components/schemas/ManagedPermissionPolicy'
          nullable: true
          default:
            type: always_allow
          description: 工具集默认权限策略；省略或传 null 时为 always_allow。
      additionalProperties: false
    ManagedBuiltinToolConfigInput:
      oneOf:
        - type: object
          properties:
            name:
              type: string
              enum:
                - read
                - write
                - edit
                - bash
                - grep
                - find
                - ls
            enabled:
              type: boolean
              nullable: true
              description: 覆盖当前工具的 enabled；省略或传 null 时继承 default_config。
            permission_policy:
              allOf:
                - $ref: '#/components/schemas/ManagedPermissionPolicy'
              nullable: true
              description: 覆盖当前工具的权限策略；省略或传 null 时继承 default_config。
            type:
              type: string
              enum:
                - read
                - write
                - edit
                - bash
                - grep
                - find
                - ls
              description: 可选，若提供必须等于 name。
          required:
            - name
          additionalProperties: false
          title: 沙箱工具
          description: type/name 若同时提供必须相等。
        - type: object
          properties:
            name:
              type: string
              enum:
                - web_search
            enabled:
              type: boolean
              nullable: true
              description: 覆盖当前工具的 enabled；省略或传 null 时继承 default_config。
            permission_policy:
              allOf:
                - $ref: '#/components/schemas/ManagedPermissionPolicy'
              nullable: true
              description: 覆盖当前工具的权限策略；省略或传 null 时继承 default_config。
            type:
              type: string
              enum:
                - web_search
            user_location:
              type: object
              properties:
                type:
                  type: string
                  enum:
                    - approximate
                city:
                  type: string
                  maxLength: 255
                region:
                  type: string
                  maxLength: 255
                country:
                  type: string
                  pattern: ^[A-Z]{2}$
                timezone:
                  type: string
              required:
                - type
              additionalProperties: false
              nullable: true
          required:
            - name
          additionalProperties: false
          title: web_search
          description: allowed_domains/blocked_domains 暂不接受：配置时 400，不是静默失效。
        - type: object
          properties:
            name:
              type: string
              enum:
                - web_fetch
            enabled:
              type: boolean
              nullable: true
              description: 覆盖当前工具的 enabled；省略或传 null 时继承 default_config。
            permission_policy:
              allOf:
                - $ref: '#/components/schemas/ManagedPermissionPolicy'
              nullable: true
              description: 覆盖当前工具的权限策略；省略或传 null 时继承 default_config。
            type:
              type: string
              enum:
                - web_fetch
            max_content_tokens:
              type: integer
              minimum: 1
              nullable: true
          required:
            - name
          additionalProperties: false
          title: web_fetch
          description: allowed_domains/blocked_domains 暂不接受：配置时 400，不是静默失效。
    ManagedMcpToolConfigInput:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          description: MCP Server 实际公开的工具名；同一 configs 数组内不得重复。
        enabled:
          type: boolean
          nullable: true
          description: 覆盖当前 MCP 工具的 enabled；省略或传 null 时继承 default_config。
        permission_policy:
          allOf:
            - $ref: '#/components/schemas/ManagedPermissionPolicy'
          nullable: true
          description: 覆盖当前 MCP 工具的权限策略；省略或传 null 时继承 default_config。
      required:
        - name
      additionalProperties: false
    ManagedImageSource:
      description: >-
        图片来源为 base64、url 或 file。每事件最多 50 张，单张最多 50 MiB；1–20 张时宽高各不超过 8000
        px，21–50 张时各不超过 2000 px。图片 Base64 总量最多 112 MiB，带图请求体最多 128 MiB。
      oneOf:
        - title: base64
          allOf:
            - $ref: '#/components/schemas/ManagedImageBase64Source'
        - title: url
          allOf:
            - $ref: '#/components/schemas/ManagedImageUrlSource'
        - title: file
          allOf:
            - $ref: '#/components/schemas/ManagedImageFileSource'
    ManagedPermissionPolicy:
      type: object
      properties:
        type:
          type: string
          enum:
            - always_allow
            - always_ask
          description: 工具调用权限策略。always_allow 表示无需确认；always_ask 表示每次调用前请求确认。
      required:
        - type
      additionalProperties: false
    ManagedImageBase64Source:
      type: object
      properties:
        type:
          type: string
          enum:
            - base64
          description: 内联 Base64 图片。
        media_type:
          type: string
          enum:
            - image/jpeg
            - image/png
            - image/gif
            - image/webp
          description: 图片 MIME 类型。
        data:
          type: string
          description: 标准 Base64 字符串；单张解码后不超过 50 MiB，且须满足像素与请求总量限制。
      required:
        - type
        - media_type
        - data
      additionalProperties: false
      title: base64
    ManagedImageUrlSource:
      type: object
      properties:
        type:
          type: string
          enum:
            - url
        url:
          type: string
          description: 可从平台访问的公网 HTTPS 图片地址；抓取受账号网络策略限制，建议优先使用 file_id。
          format: uri
      required:
        - type
        - url
      additionalProperties: false
      title: url
    ManagedImageFileSource:
      type: object
      properties:
        type:
          type: string
          enum:
            - file
        file_id:
          type: string
          description: 通过 Files API 上传的、当前调用身份有权访问的图片文件 ID。
      required:
        - type
        - file_id
      additionalProperties: false
      title: file
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.