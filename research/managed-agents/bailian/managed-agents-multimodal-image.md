---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-multimodal-image
fetched: 2026-10-23
title: 进阶：多模态输入与图片问答
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 进阶：多模态输入与图片问答

> 图片经上传与审核后以 file_id 进入会话：发送图文混合消息、用可控图片验证识别结果，以及当前的模型与输入格式限制。

<meta property="og:title" content="进阶：多模态输入与图片问答" />

## 概述 <span id="h-mi-intro" />

本篇讲把图片交给 Agent 的完整链路：上传图片、等到审核通过、向会话发送同时包含文字和图片的消息，并验证答案确实回应了图片内容。

## 场景：业务侧提交一张图片和一个问题 <span id="h-mi-scenario" />

业务流程里收到一张图片（截图、照片、图表）和一个问题，需要转交给 Agent 回答，并把答案回填到业务系统。链路本身很短，两个工程点值得注意：图片必须先过完上传审核再发送；**答案是否真的看了图，需要验证**——HTTP 200 和回合正常结束都不能证明图片识别成功。

## 图片输入：file\_id 链路 <span id="h-mi-chain" />

### 1. 上传图片 <span id="h-mi-step1" />

通过 multipart 格式上传，保存返回的 File ID：

```bash
curl -s -X POST "$AGENTSTUDIO_URL/files" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY" \
  -F "file=@red-64.png"
```

### 2. 轮询到 available <span id="h-mi-step2" />

上传后文件进入审核，在截止时间内轮询直到状态为 `available`：

```bash
curl -s "$AGENTSTUDIO_URL/files/$FILE_ID" \
  -H "Authorization: Bearer $DASHSCOPE_API_KEY"
```

如果状态变为被拒绝，停止后续流程，不要发送这条消息。

### 3. 发送图文混合消息 <span id="h-mi-step3" />

向会话发送一条 `message` 事件，`content` 数组里同时放文字与图片：

```json
{
  "input": [{
    "type": "message",
    "role": "user",
    "content": [
      {"type": "text", "text": "识别图片的主色，只回答颜色名称。"},
      {"type": "image", "file_id": "<available_image_file_id>"}
    ]
  }]
}
```

### 4. 验证答案 <span id="h-mi-step4" />

检查助手答案与回合结束状态。针对一张程序生成的纯红色 PNG（64×64），预期回答是 `Red`——用一个**已知答案的可控图片**验证链路，是这一步的关键：`end_turn` 只说明回合正常结束，不说明模型真的看到了图片。

2026-10-15 实测：`qwen3.8-max` 通过 `file_id` 链路正确回答 `Red`，全程无工具调用；`auto` 与 `qwen3.7-plus` 在 2026-10-09 的实测中同样完成识别。模型选择以控制台为准。

<Warning>
  **`performance` 不支持多模态输入**。实测请求 `performance` 时，助手明确表示不能查看图片。本篇场景改用 `auto` 或明确支持图片的模型；更新 Agent 不会改变已有会话固定使用的版本，换模型后需要新建会话再生效。
</Warning>

<Note>
  **图片输入当前使用 `file_id`，不使用 Base64 `image_data`**。早期以 Base64 数据发送时，请求被接受、历史事件里也保留了图片内容块，但模型表示看不到图片；改用上传文件的 `file_id` 后可以正常识别。将来若明确宣布支持 Base64，再复测这条路径。
</Note>

## type: "image" 与 type: "file" 的分工 <span id="h-mi-types" />

两种内容块都带 `file_id`，用途不同：

- **`type: "image"`**：把图片送进模型的视觉通道，用于「看」——回答图片内容相关的问题；
- **`type: "file"`**（`file_id` + `filename`）：把文件物化到会话沙箱的文件系统，供工具读取处理，模型不一定「看得到」内容本身。

图片问答用前者；要让 Agent 用脚本处理文件，用后者。文件进入沙箱后的挂载与读取链路见[入门：搭一个数据分析 Agent](managed-agents-data-analysis.md)。

## 小结 <span id="h-mi-summary" />

- **图片链路只有四步**：multipart 上传 → 轮询到 `available` → 发图文混合消息 → 验证答案；
- **验证用可控图片**：已知答案的图片才能区分「真的识别了」和「回合正常结束」；
- **模型有限制**：`performance` 不支持多模态输入；换模型后新建会话；
- **输入格式用 `file_id`**：Base64 `image_data` 当前不支持。

## 下一步 <span id="h-mi-next" />

- [发送 Event API](api/event-post.md)：多模态内容块的完整字段与响应结构。
- [入门：搭一个数据分析 Agent](managed-agents-data-analysis.md)：文件上传、挂载与工具读取的完整链路。
- [Agent 定义](managed-agents-agent-definition.md)：模型 ID 与 `enable_thinking` 等配置字段。
