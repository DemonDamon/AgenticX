---
source: https://docs.bigmodel.cn/cn/managed-agents/faq
fetched: 2026-10-23
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 常见问题

**Q：创建 Agent 时不写 tools，会自带沙箱工具吗？**

**A：** 不会。省略 **tools** 等价于空数组，内置工具不会自动启用。需要 bash、读文件等能力时，请显式加入 **agent\_toolset\_20260601**。详见[工具](tools.md)。

***

**Q：glm-5.3、glm-5.3-flash 和 glm-5.3-flashx 怎么选？**

**A：** 要更强推理、处理复杂场景、能多想一会儿，用 **glm-5.3**。更在意首响速度或需要读图，可选 **glm-5.3-flash**；希望响应更快，可选 **glm-5.3-flashx**——它是 Flash 系列中速度更快的一款，同样支持读图。三款都支持 low / high / max，可在创建 Agent 时用 `{"id": "...", "effort": "..."}` 指定。详见[定义 Agent](agent-setup.md#设置推理强度)。

***

**Q：能用 Coding Plan 套餐额度跑 Managed Agents 吗？**

**A：** 暂不支持。Managed Agents 按开放平台 API 的实际用量计费，不能使用 Coding Plan 套餐额度。见[计费](overview.md#计费)。

***

**Q：怎么判断这一轮做完了？**

**A：** 先看 **session.status\_idle**，再检查这条历史事件的 **stop\_reason.type**：**end\_turn** 表示本轮结束，可以发下一条 **user.message**，但中断也使用这一原因，是否完成任务仍需核对消息、错误与产物；**requires\_action** 表示在等你回工具结果或批准；**retries\_exhausted** 表示执行重试耗尽；**refusal** 表示模型拒答。Session 详情不返回停止原因。

***

**Q：创建 Session 时传了 initial\_events，还要再发一条消息吗？**

**A：** 不需要。initial\_events 非空时，会话创建后会自动开始执行；重复发送同一任务会执行两次。由于 SSE 是 live-only，创建后立即连接流，并用历史事件接口补齐连接前发生的事件。详见[创建会话](create-session.md#用初始事件预置会话)。

***

**Q：会话停在 idle 或 requires\_action，下一步做什么？**

**A：** 先看 **session.status\_idle** 的 **stop\_reason**：

* **end\_turn**：本轮已结束。再发 **user.message** 即可继续。
* **requires\_action**：在等你处理 **event\_ids** 里列出的调用。自定义工具回 **user.custom\_tool\_result**，审批回 **user.tool\_confirmation**。此时发 **user.message** 会被拒绝（400）。

详见[事件与流式输出](events.md)。

***

**Q：怎么打断正在跑的 Agent？中途追加消息会怎样？**

**A：** 发送 **user.interrupt** 后，平台会主动停止当前模型响应，并向运行中的命令发出停止信号；命令在宽限期内（当前约 3 秒）没有结束会被强制终止，本轮必然停下。请求入队后接口立即返回；等待 **session.status\_idle(end\_turn)** 再确认本轮已经结束，中断不会产生 session.error。interrupt 之前尚未处理的消息会被跳过，之后提交的 **user.message** 会在下一轮执行。若停在 requires\_action，interrupt 会取消整组等待中的工具调用和审批。详见[事件与流式输出](events.md)。

***

**Q：改了 Agent 或 Environment，已经在跑的会话会跟着变吗？**

**A：** 不会。创建会话时会钉住当时的 Agent 配置（含会话级覆盖）和环境快照，之后改 Agent 或 Environment 只影响之后新建的会话。定时任务每次触发会按环境**当时**的配置开一条新会话。要在某个已有会话里换工具，须等它 **idle**，再更新该会话的 **agent.tools**。

***

**Q：Web Search / Web Fetch 现在能用吗？**

**A：** 已可用。用 Web Search 发现来源，用 Web Fetch 读取 URL 正文；工具调用费用限时免费至 2026-10-31，之后按调用收费。详见[工具 · 联网搜索与网页读取](tools.md#联网搜索与网页读取)。

***

**Q：更新 Agent 返回 409 是什么意思？**

**A：** 请求里带了 **version**，但服务器上的当前版本已经变了——通常是别人（或另一次请求）刚更新过。先 GET 最新 Agent，用返回的 version 再更新；CI 这类声明式同步可以省略 version，后写覆盖。

***

**Q：归档和删除有什么区别？**

**A：** 归档把资源变成只读：Agent / Environment 归档后不能再开新会话，已有会话继续；会话归档后只读。删除会拿掉资源本身。归档会话再删除是允许的；running 中的会话要先 **user.interrupt**。各资源细节见对应指南页。

***

**Q：环境未归档是什么意思？创建会话失败？**

**A：** 创建会话必须引用你自己的、未归档 Environment。归档或删除后的环境不能再绑新会话；仍挂在该环境上的会话，在下一次需要使用环境时可能被终止。

***

**Q：SSE 断线后怎么续？会从上次的位置接着推吗？**

**A：** 不会。流是 live-only，只推连接建立之后的事件。重新连接后，从最后一个非空 **processed\_at** 用 **created\_at\[gte]** 补拉历史，翻完 next\_page，并按 id 去重；若没有时间锚点，则不带时间过滤回放。恢复正在执行的一轮时，继续用历史接口核对，直到看到结束状态。示例见[事件与流式输出](events.md#断线恢复)。

***

**Q：定时任务能用自定义工具 / always\_ask 吗？**

**A：** 可以创建。但触发后没有人在线回工具结果或批准，会话会停在 **requires\_action**，直到你通过事件接口补上。无人值守的 cron 请只用内置工具和 **always\_allow** 的 MCP，凭据走 **vault\_ids**。

***

**Q：MCP 连不上，会话还会启动吗？**

**A：** 会。创建会话不预检 MCP。服务器不可达或凭据被拒时，会话照常交互，同时发 **session.error**（含 **mcp\_server\_name** 与 **retry\_status**）。可以事先调用 **mcp\_oauth\_validate**。详见[连接 MCP](mcp.md)。

***

**Q：有控制台吗？**

**A：** 有，API 与控制台均已全量开放。可按[快速入门（控制台）](console-quickstart.md)创建 Agent 并运行任务，按[会话调试](session-debugging.md)查看执行过程，使用[评测与自迭代](evaluation.md)批量验证效果。

***

**Q：怎么看一次对话消耗了多少 tokens？**

**A：** 会话详情中的 `usage` 记录累计 Token 用量；需要查看单次模型调用时，读取 `span.model_request_end` 事件中的 `model_usage`。用量统计不能代替最终账单。

***

**Q：Agent 生成的文件在哪里下载？**

**A：** 让 Agent 写到 **/mnt/session/outputs**，再用 `GET /v1/files?scope_id=$SESSION_ID` 列出并下载。写在 /workspace 的中间文件不会被编目。见[文件](files.md)。

***

**Q：第一轮写在 /workspace 的文件，第二轮为什么找不到？**

**A：** **/mnt/session/outputs** 始终跨轮保留，也可按会话下载。**/workspace** 默认不跨轮保留。要保留 /workspace、/tmp 或运行期安装的软件包，创建会话时加 **x-checkpoint: true**；稳定依赖仍建议写进 Environment packages。详见[创建会话 · 跨轮保留沙箱文件](create-session.md#跨轮保留沙箱文件)。

## 新能力常见问题

**Q：普通 Agent 必须改成Multi Agent 吗？**

不需要。multiagent 是可选配置；已有普通 Session 仍只有主线程。要开启/关闭修改 Agent 生成新版本，新 API Session 使用新版本。

**Q：Advisor 是普通自定义工具吗？**

不是。配置顾问后平台向主线程注入无参 advisor 工具，完成一次性模型咨询，客户端不执行 handler，见[Multi Agent](multiagent.md)。

**Q：配置域名白名单会被忽略吗？**

不会静默接受。当前 allowed\_domains/blocked\_domains 在配置阶段 400 拒绝；域名过滤尚未由 Web 上游支持。

**Q：删除 Skill 会让正在用的 Session 立刻坏掉吗？**

已解析固定的会话保留可运行字节；目录已摘牌的 Skill 不可用于新引用。旧协议跟随 latest 的会话与新协议固定会话语义不同，见[Skills](skills.md)。


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.