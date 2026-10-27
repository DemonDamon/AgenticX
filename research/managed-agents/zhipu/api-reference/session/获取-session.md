---
source: https://docs.bigmodel.cn/api-reference/managed-agents--session/获取-session
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 获取 Session

> 获取指定 Session 的配置、状态、关联 Agent 与 Environment，以及归档和错误信息。无读取权限时与资源不存在时均返回 404。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json get /agent/managed/v1/sessions/{sessionId}
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
  /agent/managed/v1/sessions/{sessionId}:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    get:
      tags:
        - Managed Agents - Session
      summary: 获取 Session
      description: >-
        获取指定 Session 的配置、状态、关联 Agent 与 Environment，以及归档和错误信息。无读取权限时与资源不存在时均返回
        404。
      operationId: managedGetSessionsBySessionId
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: sessionId
          in: path
          required: true
          description: sessionId 资源标识。
          schema:
            type: string
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
  schemas:
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
    ManagedMetadata:
      type: object
      additionalProperties:
        type: string
      description: 客户端自定义元数据；省略时默认为空对象。最多 16 个键，键名长度不超过 64 字符，值必须是长度不超过 512 字符的字符串。
      maxProperties: 16
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