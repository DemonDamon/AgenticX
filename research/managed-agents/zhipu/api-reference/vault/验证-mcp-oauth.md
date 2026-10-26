---
source: https://docs.bigmodel.cn/api-reference/managed-agents--vault/验证-mcp-oauth
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 验证 MCP OAuth

> 验证指定 MCP OAuth Credential 当前是否能访问其 MCP Server。该操作只执行连通性与认证校验，不返回敏感 Token。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/vaults/{vaultId}/credentials/{credentialId}/mcp_oauth_validate
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
  /agent/managed/v1/vaults/{vaultId}/credentials/{credentialId}/mcp_oauth_validate:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - Vault
      summary: 验证 MCP OAuth
      description: >-
        验证指定 MCP OAuth Credential 当前是否能访问其 MCP Server。该操作只执行连通性与认证校验，不返回敏感
        Token。
      operationId: managedPostVaultsByVaultIdCredentialsByCredentialIdMcpOauthValidate
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: vaultId
          in: path
          required: true
          description: vaultId 资源标识。
          schema:
            type: string
        - name: credentialId
          in: path
          required: true
          description: credentialId 资源标识。
          schema:
            type: string
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedCredentialValidation'
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
    ManagedCredentialValidation:
      type: object
      properties:
        type:
          type: string
          enum:
            - vault_credential_validation
        credential_id:
          type: string
        vault_id:
          type: string
        validated_at:
          type: string
          format: date-time
          description: 验证时间。
        has_refresh_token:
          type: boolean
        status:
          type: string
          enum:
            - valid
            - invalid
            - unknown
        mcp_probe:
          type: object
          properties:
            method:
              type: string
              enum:
                - initialize
            http_response:
              allOf:
                - $ref: '#/components/schemas/ManagedCapturedHttpResponse'
              nullable: true
          required:
            - method
            - http_response
          additionalProperties: false
        refresh:
          type: object
          properties:
            status:
              type: string
              enum:
                - succeeded
                - failed
                - connect_error
                - no_refresh_token
            http_response:
              allOf:
                - $ref: '#/components/schemas/ManagedCapturedHttpResponse'
              nullable: true
          required:
            - status
            - http_response
          additionalProperties: false
      required:
        - type
        - credential_id
        - vault_id
        - validated_at
        - has_refresh_token
        - status
        - mcp_probe
        - refresh
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
    ManagedCapturedHttpResponse:
      type: object
      properties:
        status_code:
          type: integer
        content_type:
          type: string
        body:
          type: string
        body_truncated:
          type: boolean
      required:
        - status_code
        - content_type
        - body
        - body_truncated
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