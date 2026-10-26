---
source: https://docs.bigmodel.cn/api-reference/managed-agents--environment/更新-environment
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 更新 Environment

> 更新指定 Environment 的名称、说明、元数据或云端配置。未提供的字段保持不变；归档后的 Environment 不能再绑定到新的 Session 或 Deployment。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/environments/{environmentId}
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
  /agent/managed/v1/environments/{environmentId}:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - Environment
      summary: 更新 Environment
      description: >-
        更新指定 Environment 的名称、说明、元数据或云端配置。未提供的字段保持不变；归档后的 Environment 不能再绑定到新的
        Session 或 Deployment。
      operationId: managedPostEnvironmentsByEnvironmentId
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: environmentId
          in: path
          required: true
          description: environmentId 资源标识。
          schema:
            type: string
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ManagedEnvironmentUpdateRequest'
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedEnvironment'
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
    ManagedEnvironmentUpdateRequest:
      type: object
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 256
          description: 替换名称；省略时保持不变。
        description:
          type: string
          nullable: true
          maxLength: 1024
          description: 替换用途说明；null 表示清空，省略时保持不变。
        metadata:
          $ref: '#/components/schemas/ManagedMetadataPatch'
        scope:
          type: string
          nullable: true
          enum:
            - organization
          description: 只能为 organization；null 或省略不会改变现有作用域。
        config:
          allOf:
            - $ref: '#/components/schemas/ManagedEnvironmentConfigInput'
          nullable: true
          description: 替换完整配置；null 表示恢复默认 cloud 配置，省略时保持不变。
    ManagedEnvironment:
      type: object
      properties:
        id:
          type: string
          description: Environment ID。
          example: env_019e8f00-1ac2-7a6b-8000-3f2d5c8b9a01
        type:
          type: string
          enum:
            - environment
        name:
          type: string
        description:
          type: string
          nullable: true
          description: 用途说明。
        metadata:
          $ref: '#/components/schemas/ManagedMetadata'
        config:
          $ref: '#/components/schemas/ManagedEnvironmentConfigResponse'
        scope:
          type: string
          enum:
            - organization
        state:
          type: string
          enum:
            - active
            - archived
        archived_at:
          type: string
          nullable: true
          description: 归档时间。
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
        - name
        - description
        - metadata
        - config
        - scope
        - state
        - archived_at
        - created_at
        - updated_at
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
    ManagedMetadataPatch:
      type: object
      properties: {}
      nullable: true
      maxProperties: 16
      additionalProperties:
        type: string
        nullable: true
      description: 元数据补丁；省略整个字段时保持不变，键值为 null 时删除对应键。最多 16 个键，键名长度不超过 64 字符，字符串值不超过 512 字符。
    ManagedEnvironmentConfigInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - cloud
          description: 当前只支持 cloud；self_hosted 会被拒绝。
        packages:
          allOf:
            - $ref: '#/components/schemas/ManagedEnvironmentPackagesInput'
          nullable: true
          default: null
          description: 包声明；省略或传 null 时六类包列表均为空。
        networking:
          allOf:
            - $ref: '#/components/schemas/ManagedEnvironmentNetworkingInput'
          nullable: true
          default: null
          description: 网络策略；省略或传 null 时为 unrestricted。
      required:
        - type
      additionalProperties: false
    ManagedMetadata:
      type: object
      additionalProperties:
        type: string
      description: 客户端自定义元数据；省略时默认为空对象。最多 16 个键，键名长度不超过 64 字符，值必须是长度不超过 512 字符的字符串。
      maxProperties: 16
    ManagedEnvironmentConfigResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - cloud
        packages:
          $ref: '#/components/schemas/ManagedEnvironmentPackagesResponse'
        networking:
          $ref: '#/components/schemas/ManagedEnvironmentNetworkingResponse'
      required:
        - type
        - packages
        - networking
      additionalProperties: false
    ManagedEnvironmentPackagesInput:
      type: object
      properties:
        type:
          type: string
          enum:
            - packages
          description: 可选判别字段；提供时只能为 packages。
        apt:
          type: array
          nullable: true
          maxItems: 200
          default: []
          description: >-
            最多 200 个不同包名；null/省略视为空数组，重复项会去重。每项 trim 后不能为空、不能包含空白或控制字符，也不能以 -
            开头。
          items:
            type: string
            minLength: 1
            maxLength: 256
        cargo:
          type: array
          nullable: true
          maxItems: 200
          default: []
          description: >-
            最多 200 个不同包名；null/省略视为空数组，重复项会去重。每项 trim 后不能为空、不能包含空白或控制字符，也不能以 -
            开头。
          items:
            type: string
            minLength: 1
            maxLength: 256
        gem:
          type: array
          nullable: true
          maxItems: 200
          default: []
          description: >-
            最多 200 个不同包名；null/省略视为空数组，重复项会去重。每项 trim 后不能为空、不能包含空白或控制字符，也不能以 -
            开头。
          items:
            type: string
            minLength: 1
            maxLength: 256
        go:
          type: array
          nullable: true
          maxItems: 200
          default: []
          description: >-
            最多 200 个不同包名；null/省略视为空数组，重复项会去重。每项 trim 后不能为空、不能包含空白或控制字符，也不能以 -
            开头。
          items:
            type: string
            minLength: 1
            maxLength: 256
        npm:
          type: array
          nullable: true
          maxItems: 200
          default: []
          description: >-
            最多 200 个不同包名；null/省略视为空数组，重复项会去重。每项 trim 后不能为空、不能包含空白或控制字符，也不能以 -
            开头。
          items:
            type: string
            minLength: 1
            maxLength: 256
        pip:
          type: array
          nullable: true
          maxItems: 200
          default: []
          description: >-
            最多 200 个不同包名；null/省略视为空数组，重复项会去重。每项 trim 后不能为空、不能包含空白或控制字符，也不能以 -
            开头。
          items:
            type: string
            minLength: 1
            maxLength: 256
      additionalProperties: false
      description: 声明需要预装的包；六类包管理器均可省略，省略或 null 会规范化为空数组。
    ManagedEnvironmentNetworkingInput:
      oneOf:
        - title: unrestricted
          type: object
          properties:
            type:
              type: string
              enum:
                - unrestricted
          required:
            - type
          additionalProperties: false
        - title: limited
          type: object
          properties:
            type:
              type: string
              enum:
                - limited
            allowed_hosts:
              type: array
              nullable: true
              maxItems: 256
              default: []
              description: >-
                最多 256 个不同 host；null/省略视为空数组，重复项会去重。只接受 hostname 或 *.example.com
                通配形式，不得包含协议、端口或路径。
              items:
                type: string
                maxLength: 255
            allow_package_managers:
              type: boolean
              nullable: true
              default: false
              description: >-
                是否允许包管理器联网；省略或传 null 时为 false。limited 模式声明 packages 时必须显式设为
                true。
            allow_mcp_servers:
              type: boolean
              nullable: true
              default: false
              description: 是否允许已配置的 MCP Server 联网；省略或传 null 时为 false。
          required:
            - type
          additionalProperties: false
      description: 网络策略。省略整个 networking 时默认为 unrestricted；所有模式的出站端口均限 HTTP/HTTPS 80/443。
    ManagedEnvironmentPackagesResponse:
      type: object
      properties:
        type:
          type: string
          enum:
            - packages
        apt:
          type: array
          items:
            type: string
        cargo:
          type: array
          items:
            type: string
        gem:
          type: array
          items:
            type: string
        go:
          type: array
          items:
            type: string
        npm:
          type: array
          items:
            type: string
        pip:
          type: array
          items:
            type: string
      required:
        - type
        - apt
        - cargo
        - gem
        - go
        - npm
        - pip
      additionalProperties: false
    ManagedEnvironmentNetworkingResponse:
      oneOf:
        - title: unrestricted
          type: object
          properties:
            type:
              type: string
              enum:
                - unrestricted
          required:
            - type
          additionalProperties: false
        - title: limited
          type: object
          properties:
            type:
              type: string
              enum:
                - limited
            allowed_hosts:
              type: array
              items:
                type: string
            allow_package_managers:
              type: boolean
            allow_mcp_servers:
              type: boolean
          required:
            - type
            - allowed_hosts
            - allow_package_managers
            - allow_mcp_servers
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