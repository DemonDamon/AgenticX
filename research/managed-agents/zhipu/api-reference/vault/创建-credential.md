---
source: https://docs.bigmodel.cn/api-reference/managed-agents--vault/创建-credential
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Credential

> 在指定 Vault 中创建 Credential。支持 MCP OAuth、静态 Bearer、通用 OAuth、Bearer 和环境变量凭据；敏感字段只写不回显。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/vaults/{vaultId}/credentials
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
  /agent/managed/v1/vaults/{vaultId}/credentials:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - Vault
      summary: 创建 Credential
      description: >-
        在指定 Vault 中创建 Credential。支持 MCP OAuth、静态 Bearer、通用 OAuth、Bearer
        和环境变量凭据；敏感字段只写不回显。
      operationId: managedPostVaultsByVaultIdCredentials
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: vaultId
          in: path
          required: true
          description: vaultId 资源标识。
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ManagedCredentialCreateRequest'
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedCredential'
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
    ManagedCredentialCreateRequest:
      type: object
      properties:
        display_name:
          type: string
          maxLength: 255
          default: ''
          description: Credential 显示名称；省略时为空字符串，最长 255 个字符。
        metadata:
          allOf:
            - $ref: '#/components/schemas/ManagedMetadata'
          description: 可选元数据；省略时为空。
        auth:
          allOf:
            - $ref: '#/components/schemas/ManagedCredentialAuthCreate'
          description: 凭据类型及 secret。secret 字段仅写入，不会在响应中返回。
      required:
        - auth
    ManagedCredential:
      type: object
      properties:
        type:
          type: string
          enum:
            - vault_credential
        id:
          type: string
        display_name:
          type: string
        vault_id:
          type: string
        metadata:
          $ref: '#/components/schemas/ManagedMetadata'
        auth:
          $ref: '#/components/schemas/ManagedCredentialAuthResponse'
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
        - type
        - id
        - display_name
        - vault_id
        - metadata
        - auth
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
    ManagedMetadata:
      type: object
      additionalProperties:
        type: string
      description: 客户端自定义元数据；省略时默认为空对象。最多 16 个键，键名长度不超过 64 字符，值必须是长度不超过 512 字符的字符串。
      maxProperties: 16
    ManagedCredentialAuthCreate:
      oneOf:
        - title: mcp_oauth
          type: object
          properties:
            type:
              type: string
              enum:
                - mcp_oauth
            mcp_server_url:
              type: string
              format: uri
              pattern: ^https://
              maxLength: 2048
              description: 公开 HTTPS Streamable HTTP URL；不得包含凭据、fragment、空 query 或旧式 SSE 路径。
            access_token:
              type: string
              minLength: 1
              writeOnly: true
            expires_at:
              type: string
              format: date-time
              nullable: true
            refresh:
              allOf:
                - $ref: '#/components/schemas/ManagedOAuthRefreshCreate'
              nullable: true
          required:
            - type
            - mcp_server_url
            - access_token
          additionalProperties: false
        - title: static_bearer
          type: object
          properties:
            type:
              type: string
              enum:
                - static_bearer
            mcp_server_url:
              type: string
              format: uri
              pattern: ^https://
              maxLength: 2048
              description: 公开 HTTPS Streamable HTTP URL；不得包含凭据、fragment、空 query 或旧式 SSE 路径。
            token:
              type: string
              minLength: 1
              writeOnly: true
          required:
            - type
            - mcp_server_url
            - token
          additionalProperties: false
        - title: oauth
          type: object
          properties:
            type:
              type: string
              enum:
                - oauth
            host:
              type: string
              format: uri
              pattern: ^https://[^/?#]+/?$
              description: HTTPS origin；不得包含路径、query、fragment 或凭据。
            access_token:
              type: string
              minLength: 1
              writeOnly: true
            expires_at:
              type: string
              format: date-time
              nullable: true
            refresh:
              allOf:
                - $ref: '#/components/schemas/ManagedOAuthRefreshCreate'
              nullable: true
          required:
            - type
            - host
            - access_token
          additionalProperties: false
        - title: bearer
          type: object
          properties:
            type:
              type: string
              enum:
                - bearer
            host:
              type: string
              format: uri
              pattern: ^https://[^/?#]+/?$
              description: HTTPS origin；不得包含路径、query、fragment 或凭据。
            token:
              type: string
              minLength: 1
              writeOnly: true
          required:
            - type
            - host
            - token
          additionalProperties: false
        - title: environment_variable
          type: object
          properties:
            type:
              type: string
              enum:
                - environment_variable
            secret_name:
              type: string
              minLength: 1
            secret_value:
              type: string
              minLength: 1
              writeOnly: true
            networking:
              $ref: '#/components/schemas/ManagedVaultNetworking'
            injection_location:
              $ref: '#/components/schemas/ManagedVaultInjectionLocationInput'
          required:
            - type
            - secret_name
            - secret_value
            - networking
          additionalProperties: false
    ManagedCredentialAuthResponse:
      oneOf:
        - title: mcp_oauth
          type: object
          properties:
            type:
              type: string
              enum:
                - mcp_oauth
            mcp_server_url:
              type: string
              format: uri
              pattern: ^https://
              maxLength: 2048
              nullable: true
              description: 公开 HTTPS Streamable HTTP URL；不得包含凭据、fragment、空 query 或旧式 SSE 路径。
            expires_at:
              type: string
              format: date-time
              nullable: true
            refresh:
              allOf:
                - $ref: '#/components/schemas/ManagedOAuthRefreshResponse'
              nullable: true
          required:
            - type
            - mcp_server_url
            - expires_at
            - refresh
          additionalProperties: false
        - title: static_bearer
          type: object
          properties:
            type:
              type: string
              enum:
                - static_bearer
            mcp_server_url:
              type: string
              format: uri
              pattern: ^https://
              maxLength: 2048
              nullable: true
              description: 公开 HTTPS Streamable HTTP URL；不得包含凭据、fragment、空 query 或旧式 SSE 路径。
          required:
            - type
            - mcp_server_url
          additionalProperties: false
        - title: oauth
          type: object
          properties:
            type:
              type: string
              enum:
                - oauth
            host:
              type: string
              format: uri
              pattern: ^https://[^/?#]+/?$
              nullable: true
              description: HTTPS origin；不得包含路径、query、fragment 或凭据。
            expires_at:
              type: string
              format: date-time
              nullable: true
            refresh:
              allOf:
                - $ref: '#/components/schemas/ManagedOAuthRefreshResponse'
              nullable: true
          required:
            - type
            - host
            - expires_at
            - refresh
          additionalProperties: false
        - title: bearer
          type: object
          properties:
            type:
              type: string
              enum:
                - bearer
            host:
              type: string
              format: uri
              pattern: ^https://[^/?#]+/?$
              nullable: true
              description: HTTPS origin；不得包含路径、query、fragment 或凭据。
          required:
            - type
            - host
          additionalProperties: false
        - title: environment_variable
          type: object
          properties:
            type:
              type: string
              enum:
                - environment_variable
            secret_name:
              type: string
              nullable: true
            networking:
              allOf:
                - $ref: '#/components/schemas/ManagedVaultNetworking'
              nullable: true
            injection_location:
              $ref: '#/components/schemas/ManagedVaultInjectionLocationResponse'
          required:
            - type
            - secret_name
            - networking
            - injection_location
          additionalProperties: false
    ManagedOAuthRefreshCreate:
      type: object
      properties:
        token_endpoint:
          type: string
          format: uri
          pattern: ^https://
          description: HTTPS URL；不得包含凭据或 fragment。
        client_id:
          type: string
          minLength: 1
          description: OAuth Client ID。
        scope:
          type: string
          nullable: true
          minLength: 1
          default: null
          description: 可选 OAuth scope；省略或传 null 时不设置。
        resource:
          type: string
          nullable: true
          minLength: 1
          default: null
          description: 可选 OAuth resource 参数；省略或传 null 时不设置，创建后不可修改。
        refresh_token:
          type: string
          minLength: 1
          writeOnly: true
          description: 用于刷新访问令牌的非空 secret，不会在响应中返回。
        token_endpoint_auth:
          allOf:
            - $ref: '#/components/schemas/ManagedTokenEndpointAuthCreate'
          description: Token Endpoint 认证方式。
      required:
        - token_endpoint
        - client_id
        - refresh_token
        - token_endpoint_auth
      additionalProperties: false
    ManagedVaultNetworking:
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
              maxItems: 16
              description: >-
                允许注入凭据的目标 host，最多 16 个；支持 IPv4、hostname 或 *.example.com
                通配形式，不得包含协议、端口或路径。
              items:
                type: string
          required:
            - type
            - allowed_hosts
          additionalProperties: false
    ManagedVaultInjectionLocationInput:
      type: object
      properties:
        header:
          type: boolean
          default: true
          description: 是否允许注入到请求头；省略时为 true。
        body:
          type: boolean
          enum:
            - false
          default: false
          description: 当前不支持请求体注入，只能为 false；省略时为 false。
      additionalProperties: false
    ManagedOAuthRefreshResponse:
      type: object
      properties:
        token_endpoint:
          type: string
          format: uri
          pattern: ^https://
          description: HTTPS URL；不得包含凭据或 fragment。
        client_id:
          type: string
        token_endpoint_auth:
          type: object
          properties:
            type:
              type: string
              enum:
                - none
                - client_secret_basic
                - client_secret_post
          required:
            - type
          additionalProperties: false
        scope:
          type: string
          nullable: true
        resource:
          type: string
          nullable: true
      required:
        - token_endpoint
        - client_id
        - token_endpoint_auth
        - scope
        - resource
      additionalProperties: false
    ManagedVaultInjectionLocationResponse:
      type: object
      properties:
        header:
          type: boolean
        body:
          type: boolean
          enum:
            - false
      required:
        - header
        - body
      additionalProperties: false
    ManagedTokenEndpointAuthCreate:
      oneOf:
        - title: none
          type: object
          properties:
            type:
              type: string
              enum:
                - none
          required:
            - type
          additionalProperties: false
        - title: client_secret
          type: object
          properties:
            type:
              type: string
              enum:
                - client_secret_basic
                - client_secret_post
            client_secret:
              type: string
              minLength: 1
              writeOnly: true
          required:
            - type
            - client_secret
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