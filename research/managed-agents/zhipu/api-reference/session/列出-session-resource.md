---
source: https://docs.bigmodel.cn/api-reference/managed-agents--session/列出-session-resource
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Session Resource

> 分页列出 Session 挂载的 File 与 Memory Store Resource，结果按创建时间稳定排序。



## OpenAPI

````yaml /openapi/openapi-managed-agents.json get /agent/managed/v1/sessions/{sessionId}/resources
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
  /agent/managed/v1/sessions/{sessionId}/resources:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    get:
      tags:
        - Managed Agents - Session
      summary: 列出 Session Resource
      description: 分页列出 Session 挂载的 File 与 Memory Store Resource，结果按创建时间稳定排序。
      operationId: managedGetSessionsBySessionIdResources
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: sessionId
          in: path
          required: true
          description: sessionId 资源标识。
          schema:
            type: string
        - name: beta
          in: query
          required: false
          description: SDK 兼容参数；Session Resource 路由只识别该参数名，不校验取值。
          schema:
            type: string
        - name: limit
          in: query
          required: false
          description: 每页数量。
          schema:
            type: integer
            minimum: 1
            maximum: 1000
            default: 1000
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
                $ref: '#/components/schemas/ManagedSessionResourcePage'
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
    ManagedSessionResourcePage:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ManagedSessionResourceResponse'
        next_page:
          type: string
      required:
        - data
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.