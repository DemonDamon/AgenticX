---
source: https://docs.bigmodel.cn/api-reference/channel/delete
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 删除 Channel

> 删除 Channel 并停止后续连接与回复，保留已有会话和记忆。

<Accordion title="使用说明">

删除 Channel，停止渠道连接、会话 worker 和后续回复，并清除 Provider 凭据。已有 Memory Store、Managed Session 和审计记录保留。重复删除返回 404；删除前已发出的远端请求可能完成，但不会继续生成渠道回复。

</Accordion>



## OpenAPI

````yaml /openapi/openapi-channel.json delete /agent/forward/v0/channels/{channelId}
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
  /agent/forward/v0/channels/{channelId}:
    servers:
      - url: https://agent-api.bigmodel.cn/api
        description: 生产环境
      - url: https://dev-agent-api.bigmodel.cn/api
        description: 测试环境
    delete:
      tags:
        - Channel
      summary: 删除 Channel
      description: >-
        删除 Channel 并停止后续连接与回复，保留已有会话和记忆。


        <Accordion title="使用说明">


        删除 Channel，停止渠道连接、会话 worker 和后续回复，并清除 Provider 凭据。已有 Memory
        Store、Managed Session 和审计记录保留。重复删除返回 404；删除前已发出的远端请求可能完成，但不会继续生成渠道回复。


        </Accordion>
      operationId: forwardDeleteChannelsByChannelId
      parameters:
        - $ref: '#/components/parameters/ForwardZaiVersion'
        - $ref: '#/components/parameters/ForwardZaiBeta'
        - name: channelId
          in: path
          required: true
          description: channelId 资源标识。
          schema:
            type: string
      responses:
        '200':
          description: 请求成功。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForwardChannelDeleted'
              example:
                id: channel_xxx
                deleted: true
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
    ForwardChannelDeleted:
      type: object
      properties:
        id:
          type: string
          example: channel_xxx
        deleted:
          type: boolean
          enum:
            - true
      required:
        - id
        - deleted
      additionalProperties: false
      example:
        id: channel_xxx
        deleted: true
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
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        标准的 HTTP Bearer 认证方式，在 [API
        Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 页面获取密钥。

````

This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.