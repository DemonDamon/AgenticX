---
source: https://docs.bigmodel.cn/api-reference/managed-agents--agent/更新-agent
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Agent

> 更新 Agent 配置并生成新版本，支持通过 `version` 防止并发覆盖。

<Accordion title="使用说明">

更新指定 Agent 并生成新的不可变版本。可带当前 `version`；不一致时返回 409，避免覆盖刚发生的改动。仅所有者可更新，已归档 Agent 不可更新。MCP Server 与 `mcp_toolset` 必须按名称一一对应。

</Accordion>



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/agents/{agentId}
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
  /agent/managed/v1/agents/{agentId}:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - Agent
      summary: 更新 Agent
      description: >-
        更新 Agent 配置并生成新版本，支持通过 `version` 防止并发覆盖。


        <Accordion title="使用说明">


        更新指定 Agent 并生成新的不可变版本。可带当前 `version`；不一致时返回 409，避免覆盖刚发生的改动。仅所有者可更新，已归档
        Agent 不可更新。MCP Server 与 `mcp_toolset` 必须按名称一一对应。


        </Accordion>
      operationId: managedPostAgentsByAgentId
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: agentId
          in: path
          required: true
          description: agentId 资源标识。
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ManagedAgentUpdateRequest'
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedAgent'
              example:
                id: agent_01911111-1111-7111-8111-111111111111
                type: agent
                name: support-agent
                description: null
                model:
                  id: glm-5.3
                  effort:
                    type: max
                  speed: standard
                system: null
                tools:
                  - type: agent_toolset_20260601
                    default_config:
                      enabled: true
                      permission_policy:
                        type: always_allow
                    configs: []
                skills: []
                mcp_servers: []
                metadata: {}
                multiagent: null
                version: 1
                created_at: '2026-08-31T08:00:00.000Z'
                updated_at: '2026-08-31T08:00:00.000Z'
                archived_at: null
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
  schemas:
    ManagedAgentUpdateRequest:
      type: object
      properties:
        version:
          type: number
          minimum: 1
          description: 可选。带上当前版本号时，若期间配置已被他人改过则返回 409；省略则按本次提交覆盖。须为正整数。
        name:
          type: string
          minLength: 1
          maxLength: 256
          description: 替换 Agent 名称；省略时保持不变。
        model:
          allOf:
            - $ref: '#/components/schemas/ManagedModelInput'
          description: 替换完整模型配置；省略时保持不变。
        system:
          type: string
          nullable: true
          maxLength: 100000
          description: 替换系统提示词；null 表示清空，省略时保持不变。
        description:
          type: string
          nullable: true
          maxLength: 2048
          description: 替换用途说明；null 表示清空，省略时保持不变。
        tools:
          type: array
          nullable: true
          maxItems: 128
          description: 整体替换工具列表；null 或空数组表示清空，省略时保持不变。若包含 mcp_toolset，必须同时提交 mcp_servers。
          items:
            $ref: '#/components/schemas/ManagedAgentToolsetInput'
        skills:
          type: array
          nullable: true
          maxItems: 20
          uniqueItems: true
          description: 整体替换 Skill 列表；null 或空数组表示清空，省略时保持不变。有效配置必须包含 agent_toolset_20260601。
          items:
            $ref: '#/components/schemas/ManagedSkillReference'
        mcp_servers:
          type: array
          nullable: true
          maxItems: 20
          description: >-
            整体替换 MCP Server 列表；仅能与 tools 同时提交，null 或空数组表示清空。最终配置必须与 mcp_toolset
            按名称一一对应。
          items:
            $ref: '#/components/schemas/ManagedMcpServer'
        metadata:
          $ref: '#/components/schemas/ManagedMetadataPatch'
        multiagent:
          $ref: '#/components/schemas/ManagedMultiagent'
      additionalProperties: false
    ManagedAgent:
      type: object
      properties:
        id:
          type: string
          description: Agent ID。
          example: agent_01911111-1111-7111-8111-111111111111
        type:
          type: string
          enum:
            - agent
        name:
          type: string
        description:
          type: string
          nullable: true
          description: 用途说明。
        model:
          $ref: '#/components/schemas/ManagedModelResponse'
        system:
          type: string
          nullable: true
          description: 系统提示词。
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
        metadata:
          $ref: '#/components/schemas/ManagedMetadata'
        version:
          type: integer
          minimum: 0
        created_at:
          type: string
          format: date-time
          description: 创建时间。
        updated_at:
          type: string
          format: date-time
          description: 更新时间。
        multiagent:
          $ref: '#/components/schemas/ManagedMultiagent'
        archived_at:
          type: string
          nullable: true
          description: 归档时间；未归档时为 null。
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
        - metadata
        - version
        - created_at
        - updated_at
        - archived_at
      additionalProperties: false
      example:
        id: agent_01911111-1111-7111-8111-111111111111
        type: agent
        name: support-agent
        description: null
        model:
          id: glm-5.3
          effort:
            type: max
          speed: standard
        system: null
        tools:
          - type: agent_toolset_20260601
            default_config:
              enabled: true
              permission_policy:
                type: always_allow
            configs: []
        skills: []
        mcp_servers: []
        metadata: {}
        multiagent: null
        version: 1
        created_at: '2026-08-31T08:00:00.000Z'
        updated_at: '2026-08-31T08:00:00.000Z'
        archived_at: null
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
    ManagedMetadataPatch:
      type: object
      properties: {}
      nullable: true
      maxProperties: 16
      additionalProperties:
        type: string
        nullable: true
      description: 元数据补丁；省略整个字段时保持不变，键值为 null 时删除对应键。最多 16 个键，键名长度不超过 64 字符，字符串值不超过 512 字符。
    ManagedMultiagent:
      type: object
      properties:
        type:
          type: string
          enum:
            - coordinator
        agents:
          type: array
          items:
            $ref: '#/components/schemas/ManagedMultiagentEntry'
          description: 按 Agent ID 计最多 20 个唯一成员；Advisor 至多一个；成员不得携带自己的 Agent 列表。
      required:
        - type
        - agents
      additionalProperties: false
      nullable: true
      description: 可选，Multi Agent 主配置。null 清空，创建/更新时固定成员版本；Session override 不支持改 Agent 列表。
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
    ManagedMetadata:
      type: object
      additionalProperties:
        type: string
      description: 客户端自定义元数据；省略时默认为空对象。最多 16 个键，键名长度不超过 64 字符，值必须是长度不超过 512 字符的字符串。
      maxProperties: 16
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
    ManagedMultiagentEntry:
      oneOf:
        - type: object
          properties:
            type:
              type: string
              enum:
                - agent
            id:
              type: string
              minLength: 1
            version:
              type: integer
              minimum: 1
          required:
            - type
            - id
          additionalProperties: false
          title: 已有 Agent
        - type: object
          properties:
            type:
              type: string
              enum:
                - self
          required:
            - type
          additionalProperties: false
          title: 自身副本
        - type: object
          properties:
            type:
              type: string
              enum:
                - advisor
            model:
              type: string
              minLength: 1
          required:
            - type
            - model
          additionalProperties: false
          title: 顾问咨询
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.