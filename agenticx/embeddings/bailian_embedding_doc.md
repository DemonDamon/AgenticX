# 1. 通用文本向量快速入门
## 1.1. 输入字符串
```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处用您的API Key进行替换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"  # 百炼服务的base_url
)

completion = client.embeddings.create(
    model="text-embedding-v4",
    input='衣服的质量杠杠的，很漂亮，不枉我等了这么久啊，喜欢，以后还来这里买',
    dimensions=1024, # 指定向量维度（仅 text-embedding-v3及 text-embedding-v4支持该参数）
    encoding_format="float"
)

print(completion.model_dump_json())
```

## 1.2.输入字符串列表
```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处用您的API Key进行替换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"  # 百炼服务的base_url
)

completion = client.embeddings.create(
    model="text-embedding-v4",
    input=['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来'],
    dimensions=1024,# 指定向量维度（仅 text-embedding-v3及 text-embedding-v4支持该参数）
    encoding_format="float"
)

print(completion.model_dump_json())
```

## 1.3. 输入纯文本文件  
```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 如果您没有配置环境变量，请在此处用您的API Key进行替换
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"  # 百炼服务的base_url
)
with open('texts_to_embedding.txt', 'r', encoding='utf-8') as f:
    completion = client.embeddings.create(
        model="text-embedding-v4",
        input=f,
        dimensions=1024,  # 指定向量维度（仅 text-embedding-v3及 text-embedding-v4支持该参数）
        encoding_format="float"      
    )
print(completion.model_dump_json())
```

## 1.4. 异步处理
```python
from dashscope import BatchTextEmbedding
from http import HTTPStatus


# 创建异步任务
def create_async_task():
    rsp = BatchTextEmbedding.async_call(model=BatchTextEmbedding.Models.text_embedding_async_v1,
                                        url="https://modelscope.oss-cn-beijing.aliyuncs.com/resource/text_embedding_file.txt",
                                        text_type="document")
    if rsp.status_code == HTTPStatus.OK:
        print(rsp.output)
        print(rsp.usage)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' %
              (rsp.status_code, rsp.code, rsp.message))
    return rsp


# 获取异步任务信息
def fetch_task_status(task):
    status = BatchTextEmbedding.fetch(task)
    print(status)
    if status.status_code == HTTPStatus.OK:
        print(status.output.task_status)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' %
              (status.status_code, status.code, status.message))


# 等待异步任务结束，内部封装轮询逻辑，会一直等待任务结束
def wait_task(task):
    rsp = BatchTextEmbedding.wait(task)
    print(rsp)
    if rsp.status_code == HTTPStatus.OK:
        print(rsp.output.task_status)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' %
              (rsp.status_code, rsp.code, rsp.message))


# 取消异步任务，只有处于PENDING状态的任务才可以取消
def cancel_task(task):
    rsp = BatchTextEmbedding.cancel(task)
    print(rsp)
    if rsp.status_code == HTTPStatus.OK:
        print(rsp.output.task_status)
    else:
        print('Failed, status_code: %s, code: %s, message: %s' %
              (rsp.status_code, rsp.code, rsp.message))


if __name__ == '__main__':
    task_info = create_async_task()
    fetch_task_status(task_info)
    wait_task(task_info)
```

## 1.5 调用输出（OpenAI兼容）
```json
{ 
  "data": [
    {
      "embedding": [
        0.0023064255,
        -0.009327292,
        .... 
        -0.0028842222,
      ],
      "index": 0,
      "object": "embedding"
    }
  ],
  "model":"text-embedding-v3",
  "object":"list",
  "usage":{"prompt_tokens":26,"total_tokens":26},
  "id":"f62c2ae7-0906-9758-ab34-47c5764f07e2"
}
```

# 2. 多模态向量快速入门
## 2.1. 文本输入
```python
import dashscope
import json
from http import HTTPStatus

text = "通用多模态表征模型示例"
input = [{'text': text}]
resp = dashscope.MultiModalEmbedding.call(
    model="multimodal-embedding-v1",
    input=input
)

if resp.status_code == HTTPStatus.OK:
    print(json.dumps(resp.output, ensure_ascii=False, indent=4))
```

## 2.2. 图片输入
```python
import dashscope
import json
from http import HTTPStatus

image = "https://dashscope.oss-cn-beijing.aliyuncs.com/images/256_1.png"
input = [{'image': image}]
resp = dashscope.MultiModalEmbedding.call(
    model="multimodal-embedding-v1",
    input=input
)

if resp.status_code == HTTPStatus.OK:
    print(json.dumps(resp.output, ensure_ascii=False, indent=4))
```
## 2.3. 视频输入
```python
import dashscope
import json
from http import HTTPStatus
# 实际使用中请将url地址替换为您的视频url地址
video = "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250107/lbcemt/new+video.mp4"
input = [{'video': video}]
# 调用模型接口
resp = dashscope.MultiModalEmbedding.call(
    model="multimodal-embedding-v1",
    input=input
)

if resp.status_code == HTTPStatus.OK:
    print(json.dumps(resp.output, ensure_ascii=False, indent=4))
```

## 2.4. 输出示例
```json
{
    "status_code": 200,
    "request_id": "23478d14-55c6-98cc-9706-29d23de742fb",
    "code": "",
    "message": "",
    "output": {
        "embeddings": [
            {
                "index": 0,
                "embedding": [
                    -0.0396728515625,
                    0.00650787353515625,
                    -0.0223388671875,
                    ...
                ],
                "type": "image"
            }
        ]
    },
    "usage": {
        "input_tokens": 0,
        "image_count": 1,
        "duration": 0
    }
}
```