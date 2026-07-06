## 模型概览

| **模型名称** | **数据类型** | **向量维度** | **单次请求文本最大行数** | **单行最大输入Token** | **支持语种** |
| --- | --- | --- | --- | --- | --- |
| text-embedding-async-v2 | float（32位） | 1,536 | 100,000 | 2,048 | 中文、英语、西班牙语、法语、葡萄牙语、印尼语、日语、韩语、德语、俄罗斯语 |
| text-embedding-async-v1 | 中文、英语、西班牙语、法语、葡萄牙语、印尼语 |

| **模型名称** | **单价** **（每千输入Token）** | **免费额度（**[**注**](https://help.aliyun.com/zh/model-studio/new-free-quota#591f3dfedfyzj)**）** | **限流条件（超出任一数值时触发限流）** |   |
| --- | --- | --- | --- | --- |
| **任务下发接口RPS限制** | **同时处理中任务数量** |
| text-embedding-async-v2 | 0.0007元 | 各2000万Token 有效期：百炼开通后90天内 | 1   | 当前用户在系统通用文本向量异步作业排队中和运行中的作业数量不超过50个。 另外，为了避免大量突发的作业占据太多资源，限制并发的作业数为3个，即任意时间，单个用户最多只有3个通用文本向量的异步作业在并发运行，其他的作业只能在队列中等待。 |
| text-embedding-async-v1 |

## 前提条件

通用文本向量批处理接口API支持通过HTTP和DashScope SDK进行调用。

在调用前，您需要[获取API Key](https://help.aliyun.com/zh/model-studio/get-api-key)，再[配置API Key到环境变量](https://help.aliyun.com/zh/model-studio/configure-api-key-through-environment-variables)。

如需通过SDK进行调用，请[安装DashScope SDK](https://help.aliyun.com/zh/model-studio/install-sdk)。目前，该SDK已支持Python和Java。

## HTTP调用

HTTP调用仅支持异步模式，需通过两步完成：

1.  **创建任务**：首先发送一个请求创建任务，该请求会返回任务ID。
    
2.  **根据任务ID查询结果**：使用上一步获得的任务ID，查询模型生成的结果。
    

**通过HTTP调用时需配置的endpoint：**

`POST https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding`

### 创建任务

| ##### **请求参数** | ``` curl -X POST 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding' \\ -H "Authorization: Bearer $DASHSCOPE_API_KEY" \\ -H 'Content-Type: application/json' \\ -H 'X-DashScope-Async: enable' \\ -d '{ "model": "text-embedding-async-v2", "input": { "url": "https://modelscope.oss-cn-beijing.aliyuncs.com/resource/text_embedding_file.txt" }, "parameters": { "text_type": "query" } }' ``` |
| --- | --- |
| ###### **请求头（Headers）** |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| **Content-Type** `*string*` **（必选）** 请求内容类型。此参数必须设置为`application/json`。 |
| **X-DashScope-Async** `*string*` **（必选）** 异步处理配置参数。HTTP请求只支持异步，**必须设置为**`**enable**`。 **重要** 缺少此请求头将报错：“current user api does not support synchronous calls”。 |
| ###### **请求体（Request Body）** |
| **model** `*string*` **（必选）** 调用模型名称，可以选择`text-embedding-async-v1`或者`text-embedding-async-v2`。 |
| **input** `*object*` **（必选）** 用户需要批量向量化处理的输入。 **属性** url `*string*` **（必选）** 用户需要批量向量化的文件HTTP url。（需要embedding的内容，一行一条） 文本限制： - 单行字符串最长支持 2,048 Token - 单次请求文本最大100,000行 - 文件大小不超过 200MB |
| **parameters** `*object*` **（可选）** 向量化处理参数。 **属性** **text\\_type** `*string*` **（可选）** 参数值： - `document`(默认值) - `query` 文本转换为向量后可以应用于检索、聚类、分类等下游任务，对检索这类非对称任务为了达到更好的检索效果建议区分查询文本（query）和底库文本（document）类型；聚类、分类等对称任务无需特别指定，采用系统默认值`document`即可。 |

| ##### **响应参数** | #### 成功响应 请保存 task\\_id，用于查询任务状态与结果。 ``` { "output": { "task_status": "PENDING", "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx" }, "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx" } ``` #### 异常响应 创建任务失败，请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)进行解决。 ``` { "code": "InvalidApiKey", "message": "No API-key provided.", "request_id": "7438d53d-6eb8-4596-8835-xxxxxx" } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |
| **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 |
| **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 |

### **根据任务ID查询结果**

`GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`

| ##### **请求参数** | ## 查询任务结果 请将`86ecf553-d340-4e21-xxxxxxxxx`替换为真实的task\\_id。 > 若使用新加坡地域的模型，需将base\\_url替换为https://dashscope-intl.aliyuncs.com/api/v1/tasks/86ecf553-d340-4e21-xxxxxxxxx ``` curl -X GET https://dashscope.aliyuncs.com/api/v1/tasks/86ecf553-d340-4e21-xxxxxxxxx \\ --header "Authorization: Bearer $DASHSCOPE_API_KEY" ``` |
| --- | --- |
| ###### **请求头（Headers）** |
| **Authorization** `*string*`**（必选）** 请求身份认证。接口使用阿里云百炼API Key进行身份认证。示例值：Bearer sk-xxxx。 |
| ###### **URL路径参数（Path parameters）** |
| **task\\_id** `*string*`**（必选）** 任务ID。 |

| ##### **响应参数** | ## 任务执行成功 任务数据（如任务状态、处理结果URL等）仅保留24小时，超时后会被自动清除。请您务必及时保存生成的图像。 ``` { "request_id":"<Your Request ID>", "output":{ "task_id":"<Your Task ID>", "task_status":"SUCCEEDED", "submit_time":"2025-02-20 14:37:13.328", "scheduled_time":"2025-02-20 14:37:13.352", "end_time":"2025-02-20 14:37:14.159", "url":"<包含输出结果的url>" }, "usage":{ "total_tokens":258 } } ``` ## 任务执行中 ``` { "request_id":"<Your Request ID>", "output":{ "task_id":"<Your Task ID>", "task_status":"RUNNING" } } ``` ## 任务执行失败 如果因为某种原因导致任务执行失败，任务状态将被设置为FAILED，并通过code和message字段明确指示错误原因。 ``` { "request_id": "<Your Request ID>" "output": { "task_id": "<Your Task ID>", "task_status": "FAILED", "submit_time":"2025-02-20 15:57:19.039", "scheduled_time":"2025-02-20 15:57:19.059", "end_time":"2025-02-20 15:57:19.418", "code": "xxx", "message": "xxxxxx" } } ``` |
| --- | --- |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务ID。查询有效期24小时。 **task\\_status** `*string*` 任务状态。 **枚举值** - PENDING：任务排队中 - RUNNING：任务处理中 - SUCCEEDED：任务执行成功 - FAILED：任务执行失败 - CANCELED：任务已取消 - UNKNOWN：任务不存在或状态未知 **submit\\_time** `*string*` 任务提交时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。 **scheduled\\_time** `*string*` 任务执行时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。 **end\\_time** `*string*` 任务完成时间。格式为 YYYY-MM-DD HH:mm:ss.SSS。 **url** `*string*` 模型生成图片的URL地址。 **code** `*string*` 请求失败的错误码。请求成功时不会返回此参数，详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 **message** `*string*` 请求失败的详细信息。请求成功时不会返回此参数，详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 |
| **usage** `*object*` 输出信息统计。只对成功的结果计数。 **属性** **total\\_tokens** `*integer*` 本次请求输入内容的Token数目，根据用户输入的文本文件被模型Tokenizer解析之后所对应的Token数目来进行计算。 |
| **request\\_id** `*string*` 请求唯一标识。可用于请求明细溯源和问题排查。 |

## Dashscope

请先确认已安装最新版DashScope SDK，否则可能运行报错：[安装SDK](https://help.aliyun.com/zh/model-studio/install-sdk)。

DashScope SDK目前已支持Python和Java。

SDK与HTTP接口的参数名基本一致，参数结构根据不同语言的SDK封装而定。参数说明可参考[万相-文生图V2](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference#42703589880ts)。

由于模型处理时间较长，底层服务采用异步方式提供。SDK在上层进行了封装，支持同步、异步两种调用方式。

| #### 请求体 | ## 同步调用 ## Python ``` from dashscope import BatchTextEmbedding result = BatchTextEmbedding.call(BatchTextEmbedding.Models.text_embedding_async_v1, url="https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241016/nigwvr/text_embedding_file.txt", text_type="document") print(result) ``` ## Java ``` import com.alibaba.dashscope.embeddings.BatchTextEmbedding; import com.alibaba.dashscope.embeddings.BatchTextEmbeddingParam; import com.alibaba.dashscope.embeddings.BatchTextEmbeddingResult; import com.alibaba.dashscope.exception.ApiException; import com.alibaba.dashscope.exception.NoApiKeyException; import com.alibaba.dashscope.task.AsyncTaskListParam; import com.alibaba.dashscope.task.AsyncTaskListResult; import com.alibaba.dashscope.utils.JsonUtils; public class Main { public static void basicCall() throws ApiException, NoApiKeyException { BatchTextEmbeddingParam param = BatchTextEmbeddingParam.builder() .model(BatchTextEmbedding.Models.TEXT_EMBEDDING_ASYNC_V1) .url("https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241016/nigwvr/text_embedding_file.txt") .textType(BatchTextEmbeddingParam.TextType.DOCUMENT) .build(); BatchTextEmbedding textEmbedding = new BatchTextEmbedding(); BatchTextEmbeddingResult result = textEmbedding.call(param); System.out.println(result); } public static void main(String[] args) { try { basicCall(); } catch (ApiException \\| NoApiKeyException e) { System.out.println(e.getMessage()); } System.exit(0); } } ``` ## 异步调用 ## Python ``` from dashscope import BatchTextEmbedding from http import HTTPStatus # 创建异步任务 def create_async_task(): rsp = BatchTextEmbedding.async_call(model=BatchTextEmbedding.Models.text_embedding_async_v1, url="https://modelscope.oss-cn-beijing.aliyuncs.com/resource/text_embedding_file.txt", text_type="document") if rsp.status_code == HTTPStatus.OK: print(rsp.output) print(rsp.usage) else: print('Failed, status_code: %s, code: %s, message: %s' % (rsp.status_code, rsp.code, rsp.message)) return rsp # 获取异步任务信息 def fetch_task_status(task): status = BatchTextEmbedding.fetch(task) print(status) if status.status_code == HTTPStatus.OK: print(status.output.task_status) else: print('Failed, status_code: %s, code: %s, message: %s' % (status.status_code, status.code, status.message)) # 等待异步任务结束，内部封装轮询逻辑，会一直等待任务结束 def wait_task(task): rsp = BatchTextEmbedding.wait(task) print(rsp) if rsp.status_code == HTTPStatus.OK: print(rsp.output.task_status) else: print('Failed, status_code: %s, code: %s, message: %s' % (rsp.status_code, rsp.code, rsp.message)) # 取消异步任务，只有处于PENDING状态的任务才可以取消 def cancel_task(task): rsp = BatchTextEmbedding.cancel(task) print(rsp) if rsp.status_code == HTTPStatus.OK: print(rsp.output.task_status) else: print('Failed, status_code: %s, code: %s, message: %s' % (rsp.status_code, rsp.code, rsp.message)) if __name__ == '__main__': task_info = create_async_task() fetch_task_status(task_info) wait_task(task_info) ``` ## Java ``` import com.alibaba.dashscope.embeddings.BatchTextEmbedding; import com.alibaba.dashscope.embeddings.BatchTextEmbeddingParam; import com.alibaba.dashscope.embeddings.BatchTextEmbeddingResult; import com.alibaba.dashscope.exception.ApiException; import com.alibaba.dashscope.exception.NoApiKeyException; import com.alibaba.dashscope.task.AsyncTaskListParam; import com.alibaba.dashscope.task.AsyncTaskListResult; import com.alibaba.dashscope.utils.JsonUtils; public class Main { /**创建批处理任务*/ public static BatchTextEmbeddingResult createTask() throws ApiException, NoApiKeyException { BatchTextEmbeddingParam param = BatchTextEmbeddingParam.builder() .model(BatchTextEmbedding.Models.TEXT_EMBEDDING_ASYNC_V1) .url("https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241016/nigwvr/text_embedding_file.txt") .textType(BatchTextEmbeddingParam.TextType.DOCUMENT) .build(); BatchTextEmbedding textEmbedding = new BatchTextEmbedding(); return textEmbedding.asyncCall(param); } /**获取任务状态*/ public static void fetchTaskStatus(BatchTextEmbeddingResult result) throws ApiException, NoApiKeyException { BatchTextEmbedding textEmbedding = new BatchTextEmbedding(); result = textEmbedding.fetch(result, null); System.out.println(result); } /**等待任务结束，wait内部封装了轮询逻辑，会一直等待任务结束*/ public static void waitTask(BatchTextEmbeddingResult result) throws ApiException, NoApiKeyException { BatchTextEmbedding textEmbedding = new BatchTextEmbedding(); result = textEmbedding.wait(result, null); System.out.println(result); } /**取消任务，只能取消处于pending状态的任务*/ public static void cancelTask(BatchTextEmbeddingResult result) throws ApiException, NoApiKeyException { BatchTextEmbedding textEmbedding = new BatchTextEmbedding(); result = textEmbedding.cancel(result, null); System.out.println(result); } /**查询已经提交的任务*/ public static void list() throws ApiException, NoApiKeyException { AsyncTaskListParam param = AsyncTaskListParam.builder().pageNo(1).pageSize(20).build(); BatchTextEmbedding textEmbedding = new BatchTextEmbedding(); AsyncTaskListResult result = textEmbedding.list(param); System.out.println(JsonUtils.toJson(result)); } public static void main(String[] args) { try { BatchTextEmbeddingResult task = createTask(); fetchTaskStatus(task); waitTask(task); // list(); } catch (ApiException \\| NoApiKeyException e) { System.out.println(e.getMessage()); } System.exit(0); } } ``` |
| --- | --- | --- | --- |
| **model** `*string*` **（必选）** 调用模型名称，可以选择`text-embedding-async-v1`或者`text-embedding-async-v2`。 |
| url `*string*` **（必选）** 用户需要批量向量化的文件HTTP url。（需要向量化的内容，一行一条） 文本限制： - 单行字符串最长支持2,048Token - 单次请求文本最大100,000行 - 文件大小不超过 200MB |
| **text\\_type** `*string*` **可选** 文本转换为向量后可以应用于检索、聚类、分类等下游任务，对检索这类非对称任务为了达到更好的检索效果建议区分查询文本（query）和底库文本（document）类型；聚类、分类等对称任务可以不用特殊指定，采用系统默认值`document`即可。 |

| #### **响应参数** | ## 同步调用 ## 成功响应 ``` { "status_code": 200, "request_id": "<Your Request ID>", "code": null, "message": "", "output": { "task_id": "<Your Task ID>", "task_status": "SUCCEEDED", "url": "<包含输出结果的url>", "submit_time": "2023-09-07 10:22:52.459", "scheduled_time": "2023-09-07 10:22:52.481", "end_time": "2023-09-07 10:22:53.419" }, "usage": { "total_tokens": 384 } } ``` ## 异常响应 **请求失败** ``` { "code":"InvalidApiKey", "message":"Invalid API-key provided.", "request_id":"<Your Request ID>" } ``` **任务执行失败** ``` { "status_code": 200, "request_id": "<Your Request ID>", "code": null, "message": "", "output": { "task_id": "<Your Task ID>", "task_status": "FAILED", "url": "null", "submit_time": "2023-09-07 10:22:52.459", "scheduled_time": "2023-09-07 10:22:52.481", "end_time": "2023-09-07 10:22:53.419" "code": "InvalidFile.TypeNotTxt", "message": "File type should be txt" }, "usage": null } ``` ## 异步调用 ## 成功响应 ``` { "status_code": 200, "request_id": "<Your Request ID>", "code": null, "message": "", "output": { "task_id": "<Your Task ID>", "task_status": "SUCCEEDED", "url": "<包含输出结果的url>", "submit_time": "2025-02-21 13:51:26.465", "scheduled_time": "2025-02-21 13:51:26.507", "end_time": "2025-02-21 13:51:27.273" }, "usage": { "total_tokens": 384 } } ``` ## 异常响应 **请求失败** ``` { "code":"InvalidApiKey", "message":"Invalid API-key provided.", "request_id":"<Your Request ID>" } ``` **任务执行失败** ``` { "status_code": 200, "request_id": "<Your Request ID>", "code": null, "message": "", "output": { "task_id": "<Your Task ID>", "task_status": "FAILED", "url": "null", "submit_time": "2023-09-07 10:22:52.459", "scheduled_time": "2023-09-07 10:22:52.481", "end_time": "2023-09-07 10:22:53.419" "code": "InvalidFile.TypeNotTxt", "message": "File type should be txt" }, "usage": null } ``` |
| --- | --- |
| **status\\_code** `string` 请求状态码，表示请求的执行结果（如 200 表示成功）。详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 |
| **request\\_id** `string` 请求唯一标识。可用于请求明细溯源和问题排查。 |
| **code** `string` 请求失败时表示错误码，成功时返回参数中该参数为空。详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 |
| **message** `string` 请求失败，表示失败详细信息，成功时返回参数中该参数为空。详情请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)。 |
| **output** `*object*` 任务输出信息。 **属性** **task\\_id** `*string*` 任务唯一标识。可用于任务明细溯源和问题排查。 **task\\_status** `*string*` 任务状态 - SUCCESSED: 任务执行成功 - FAILED: 任务执行失败 - CANCELED： 任务被取消 - PENDING：任务排队中 - SUSPENDED：任务挂起 - RUNNING：任务处理中 **url** `*string*` 包含Embedding结果的url，任务执行失败时返回参数中该参数为空。 **submit\\_time** `*string*` 任务提交时间 > Java SDK的返回结果中不包含此字段 **scheduled\\_time** `*string*` 任务调度时间 > Java SDK的返回结果中不包含此字段 **end\\_time** `*string*` 任务处理结束时间 > Java SDK的返回结果中不包含此字段 **code** `*string*` 任务执行失败，表示失败原因，成功执行时响应中不会包含此参数。 **message** `*string*` 任务执行失败，表示失败详细信息，成功执行时响应中不会包含此参数。 |
| **usage** `*object*` **属性** **total\\_tokens** `*integer*` 本次请求输入内容的Token数目，算法的计量是根据用户输入字符串被模型Tokenizer解析之后对应的Token数目来进行。 |

/\* 当设备显示尺寸宽度过小时，让当做卡片的表格横向单元格改变方向，变成垂直方向显示，类似钉钉文档的分栏效果。 使用时需要为对应的 table 设置 class=column-layout。\*/ @media (max-width: 1590px) { .aliyun-docs-content table.column-layout tr, .aliyun-docs-content table.column-layout td, .aliyun-docs-content table.column-layout th { display: flex !important; flex-direction: column !important; height: auto !important; padding: 0 ; } .aliyun-docs-content table.column-layout colgroup { display: none; } }

/\* 调整 table 宽度 \*/ .aliyun-docs-content table.medium-width { max-width: 1018px; width: 100%; } .aliyun-docs-content table.table-no-border tr td:first-child { padding-left: 0; } .aliyun-docs-content table.table-no-border tr td:last-child { padding-right: 0; } /\* 支持吸顶 \*/ div:has(.aliyun-docs-content), .aliyun-docs-content .markdown-body { overflow: visible; } .stick-top { position: sticky; top: 46px; } /\*\*代码块字体\*\*/ /\* 减少表格中的代码块 margin，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body table .help-code-block { margin: 0 !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre { font-size: 12px !important; } /\* 减少表格中的代码块字号，让表格信息显示更紧凑 \*/ .unionContainer .markdown-body .help-code-block pre code { font-size: 12px !important; } /\*\* API Reference 表格 \*\*/ .aliyun-docs-content table.api-reference tr td:first-child { margin: 0px; border-bottom: 1px solid #d8d8d8; } .aliyun-docs-content table.api-reference tr:last-child td:first-child { border-bottom: none; } .aliyun-docs-content table.api-reference p { color: #6e6e80; } .aliyun-docs-content table.api-reference b, i { color: #181818; } .aliyun-docs-content table.api-reference .collapse { border: none; margin-top: 4px; margin-bottom: 4px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold { padding: 0; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold .title { margin-left: 16px; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold i.icon { position: absolute; color: #777; font-weight: 100; } .aliyun-docs-content table.api-reference .collapse.expanded .expandable-content { padding: 10px 14px 10px 14px !important; margin: 0; border: 1px solid #e9e9e9; } .aliyun-docs-content table.api-reference .collapse .expandable-title-bold b { font-size: 13px; font-weight: normal; color: #6e6e80; } .aliyun-docs-content table.api-reference .tabbed-content-box { border: none; } .aliyun-docs-content table.api-reference .tabbed-content-box section { padding: 8px 0 !important; } .aliyun-docs-content table.api-reference .tabbed-content-box.mini .tab-box { /\* position: absolute; left: 40px; right: 0; \*/ } .aliyun-docs-content .margin-top-33 { margin-top: 33px !important; } .aliyun-docs-content .two-codeblocks pre { max-height: calc(50vh - 136px) !important; height: auto; } .expandable-content section { border-bottom: 1px solid #e9e9e9; padding-top: 6px; padding-bottom: 4px; } .expandable-content section:last-child { border-bottom: none; } .expandable-content section:first-child { padding-top: 0; }

## 常见问题

### **输入文件限制**

-   输入文件需为 **UTF-8 编码的文本文件**，每行包含一个需要计算文字向量的字符串。系统会逐行处理每个输入，并在最终输出文件中返回对应的行号和生成的 embedding 结果。
    
-   单个文件大小不得超过 **200MB**。
    
-   单次请求的文本行数不得超过 **100,000 行**。
    
-   每行内容的长度不得超过 **2,048 Token**。
    
-   空行（即不包含任何字符的行）会被系统自动跳过，不会计算其文字向量。然而，为了便于结果对应，输出文件中仍会保留这些空行的行号。
    

### **输出文件说明**

-   当任务成功完成后，提交的输入数据将被转换为向量结果，并存储在输出文件中。为了节省存储空间并方便下载，输出文件会被压缩为 `.gz` 格式。下载至本地后可解压缩以获取对应的文本输出文件。
    
-   任务数据（如任务状态、处理结果URL等）仅保留24小时，超时后会被自动清除。请您务必及时保存包含任务结果的输出文件。
    
-   经过模型向量化后输出的文件是一个 jsonl 格式文件，即每一行都是一个完整的 json 结构，包含对应输入文件特定行的向量化输出。
    

## 错误码

如果模型调用失败并返回报错信息，请参见[错误码](https://help.aliyun.com/zh/model-studio/error-code)进行解决。

## 基础限流

为了保证用户调用模型的公平性，通用文本向量对用户设置了基础限流。如果超出调用限制，用户的API请求将因为限流控制而失败，用户需要等待一段时间待满足限流条件后方能再次调用。各模型详细限流条件请参见[限流](https://help.aliyun.com/zh/model-studio/rate-limit)。