---
source: https://docs.bigmodel.cn/api-reference/managed-agents--memory/创建-memory
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 创建 Memory

> 在指定 Memory Store 中创建 Memory。`path` 必须以 `/` 开头且不能包含空、`.` 或 `..` 路径段，内容受平台字节数限制。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json post /agent/managed/v1/memory_stores/{storeId}/memories
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
  /agent/managed/v1/memory_stores/{storeId}/memories:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    post:
      tags:
        - Managed Agents - Memory
      summary: 创建 Memory
      description: >-
        在指定 Memory Store 中创建 Memory。`path` 必须以 `/` 开头且不能包含空、`.` 或 `..`
        路径段，内容受平台字节数限制。
      operationId: managedPostMemoryStoresByStoreIdMemories
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: storeId
          in: path
          required: true
          description: storeId 资源标识。
          schema:
            type: string
        - name: beta
          in: query
          required: false
          description: SDK 兼容参数；提供时必须为 true。
          schema:
            type: string
            enum:
              - 'true'
        - name: view
          in: query
          required: false
          description: 返回基本信息或完整内容。
          schema:
            type: string
            enum:
              - basic
              - full
            default: basic
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ManagedMemoryCreateRequest'
      responses:
        '200':
          description: 创建成功。当前推荐协议返回 200；旧协议返回 201。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedMemory'
              example:
                id: mem_01911111-1111-7111-8111-111111111111
                type: memory
                memory_store_id: memstore_01911111-1111-7111-8111-111111111111
                memory_version_id: memver_01911111-1111-7111-8111-111111111111
                path: /preferences/reporting.md
                content_sha256: >-
                  2d650650acd86e21108c8f0f496b076288bcedaad4f8b8f1b39b96537c00d9fb
                content_size_bytes: 75
                content: null
                created_at: '2026-10-15T08:00:00.000Z'
                updated_at: '2026-10-15T08:00:00.000Z'
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
    ManagedMemoryCreateRequest:
      type: object
      properties:
        path:
          type: string
          minLength: 2
          description: NFC 路径，以 / 开头，不允许空、. 或 .. 路径段；UTF-8 最多 1024 字节。
        content:
          type: string
          description: UTF-8 内容，默认上限 102400 字节；部署可通过平台限制调整。
      required:
        - path
        - content
      additionalProperties: false
    ManagedMemory:
      type: object
      properties:
        id:
          type: string
          description: Memory ID。
          example: mem_01J...
        type:
          type: string
          enum:
            - memory
        memory_store_id:
          type: string
        memory_version_id:
          type: string
        path:
          type: string
        content_sha256:
          type: string
        content_size_bytes:
          type: integer
        content:
          type: string
          nullable: true
          description: view=full 时返回内容。
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
        - memory_store_id
        - memory_version_id
        - path
        - content_sha256
        - content_size_bytes
        - content
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.