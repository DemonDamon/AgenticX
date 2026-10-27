---
source: https://docs.bigmodel.cn/api-reference/managed-agents--deployment/列出-deployment-run
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 列出 Deployment Run

> 分页查询 Deployment 的运行记录，支持按任务、触发方式、时间和错误筛选。

<Accordion title="使用说明">

分页列出当前身份可读取的 Deployment Run，支持按 Deployment、是否有错误、触发方式和创建时间过滤。已归档 Deployment 的历史 Run 仍可查询；Run 是否成功通过 `error` 是否为 `null` 判断，响应中不包含 `status` 字段。

</Accordion>



## OpenAPI

````yaml /openapi/openapi-managed-agents.json get /agent/managed/v1/deployment_runs
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
  /agent/managed/v1/deployment_runs:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 智谱 Managed Agents 服务
    get:
      tags:
        - Managed Agents - Deployment
      summary: 列出 Deployment Run
      description: >-
        分页查询 Deployment 的运行记录，支持按任务、触发方式、时间和错误筛选。


        <Accordion title="使用说明">


        分页列出当前身份可读取的 Deployment Run，支持按 Deployment、是否有错误、触发方式和创建时间过滤。已归档
        Deployment 的历史 Run 仍可查询；Run 是否成功通过 `error` 是否为 `null` 判断，响应中不包含 `status`
        字段。


        </Accordion>
      operationId: managedGetDeploymentRuns
      parameters:
        - $ref: '#/components/parameters/ManagedZaiVersion'
        - $ref: '#/components/parameters/ManagedZaiBeta'
        - name: deployment_id
          in: query
          required: false
          description: 按 Deployment ID 过滤。
          schema:
            type: string
        - name: has_error
          in: query
          required: false
          description: 按是否包含错误过滤。
          schema:
            type: boolean
        - name: trigger_type
          in: query
          required: false
          description: 按触发方式过滤。
          schema:
            type: string
            enum:
              - schedule
              - manual
        - name: created_at[gt]
          in: query
          required: false
          description: RFC 3339 创建时间边界。
          schema:
            type: string
            format: date-time
        - name: created_at[gte]
          in: query
          required: false
          description: RFC 3339 创建时间边界。
          schema:
            type: string
            format: date-time
        - name: created_at[lt]
          in: query
          required: false
          description: RFC 3339 创建时间边界。
          schema:
            type: string
            format: date-time
        - name: created_at[lte]
          in: query
          required: false
          description: RFC 3339 创建时间边界。
          schema:
            type: string
            format: date-time
        - name: limit
          in: query
          required: false
          description: 每页数量；大于 100 时服务端截断为 100。
          schema:
            type: integer
            minimum: 1
            default: 50
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
          description: opaque cursor。
          schema:
            type: string
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ManagedDeploymentRunPage'
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
    ManagedDeploymentRunPage:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: '#/components/schemas/ManagedDeploymentRun'
        next_page:
          type: string
          nullable: true
      required:
        - data
        - next_page
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
    ManagedDeploymentRun:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
          enum:
            - deployment_run
        deployment_id:
          type: string
        trigger_context:
          type: object
          properties:
            type:
              type: string
              enum:
                - schedule
                - manual
            scheduled_at:
              type: string
              format: date-time
              description: 计划触发时间；仅定时触发的 Run 返回。
          required:
            - type
          additionalProperties: false
        session_id:
          type: string
          nullable: true
          description: 该次运行创建的会话 ID。刚返回时可能为 null，通常数秒后填上。
        error:
          allOf:
            - type: object
              properties:
                type:
                  type: string
                  enum:
                    - file_not_found_error
                    - environment_archived_error
                    - environment_not_found_error
                    - memory_store_archived_error
                    - vault_archived_error
                    - vault_not_found_error
                    - session_rate_limited_error
                    - session_creation_rejected_error
                    - customer_rate_limited
                    - unknown_error
                message:
                  type: string
              required:
                - type
                - message
              additionalProperties: false
          nullable: true
        agent:
          $ref: '#/components/schemas/ManagedDeploymentAgent'
        created_at:
          type: string
          format: date-time
          description: 创建时间。
      required:
        - id
        - type
        - deployment_id
        - trigger_context
        - session_id
        - error
        - agent
        - created_at
      additionalProperties: false
    ManagedDeploymentAgent:
      type: object
      properties:
        type:
          type: string
          enum:
            - agent
        id:
          type: string
        version:
          type: integer
          minimum: 0
      required:
        - type
        - id
        - version
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