# AgenticX意图理解智能体API接口文档

## 1. API概览

### 1.1 基础信息

* **Base URL**: `http://localhost:8000`

* **API版本**: v1

* **认证方式**: Bearer Token (可选)

* **内容类型**: `application/json`

* **字符编码**: UTF-8

* **集成方式**: 增强现有FastAPI后端意图识别服务

* **兼容性**: 完全兼容现有RequestParams和ResponseData数据结构

### 1.2 通用响应格式

```json
{
  "success": true,
  "data": {},
  "message": "操作成功",
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456789"
}
```

### 1.3 错误响应格式

```json
{
  "success": false,
  "error": {
    "code": "INTENT_ANALYSIS_FAILED",
    "message": "意图分析失败",
    "details": "模型推理超时"
  },
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456789"
}
```

## 2. 核心API端点

### 2.1 AgenticX增强接口

#### POST /api/v1/agenticx/enhance

通过AgenticX增强现有意图识别服务，提供记忆管理、智能编排和工具扩展能力。

**请求参数**:

```json
{
  "input": "帮我搜索关于机器学习的文档",
  "user_id": "user_12345",
  "session_id": "sess_001",
  "context": {
    "previous_queries": ["深度学习教程"],
    "device_type": "mobile",
    "location": "北京",
    "timestamp": "2024-01-01T12:00:00Z"
  },
  "enhance_options": {
    "enable_memory": true,
    "enable_workflow": true,
    "enable_planning": true,
    "enable_execution": false,
    "confidence_threshold": 0.7
  }
}
```

**参数说明**:

| 参数名                                    | 类型      | 必填 | 说明              |
| -------------------------------------- | ------- | -- | --------------- |
| input                                  | string  | 是  | 用户输入的自然语言文本     |
| user\_id                               | string  | 是  | 用户唯一标识符         |
| session\_id                            | string  | 否  | 会话标识符，用于记忆管理    |
| context                                | object  | 否  | 额外上下文信息         |
| context.previous\_queries              | array   | 否  | 历史查询记录          |
| context.device\_type                   | string  | 否  | 设备类型            |
| context.location                       | string  | 否  | 用户位置            |
| enhance\_options                       | object  | 否  | AgenticX增强选项    |
| enhance\_options.enable\_memory        | boolean | 否  | 是否启用记忆管理，默认true |
| enhance\_options.enable\_workflow      | boolean | 否  | 是否启用智能编排，默认true |
| enhance\_options.enable\_planning      | boolean | 否  | 是否生成执行计划，默认true |
| enhance\_options.enable\_execution     | boolean | 否  | 是否立即执行，默认false  |
| enhance\_options.confidence\_threshold | number  | 否  | 置信度阈值，默认0.7     |

**响应示例**:

```json
{
  "success": true,
  "data": {
    "request_id": "req_12345",
    "session_id": "sess_001",
    "is_need_clarify": false,
    "clarify_query": null,
    "enhanced_result": {
      "original_intent_result": {
        "intentions": [
          {
            "type": "search",
            "confidence": 0.95,
            "entities": {
              "keywords": ["机器学习"],
              "document_type": "any"
            }
          }
        ],
        "response_data": {
          "status": "success",
          "data": {
            "search_results": []
          }
        }
      },
      "agenticx_enhancements": {
        "memory_context": {
          "user_preferences": {
            "preferred_domains": ["machine_learning", "deep_learning"],
            "language": "zh-CN"
          },
          "relevant_history": [
            "用户之前查询过深度学习教程",
            "用户偏好技术文档"
          ]
        },
        "context_enrichment": {
          "suggested_keywords": ["神经网络", "深度学习", "算法"],
          "recommended_sources": ["学术论文", "技术博客"]
        }
      }
    },
    "workflow_plan": {
      "plan_id": "plan_456",
      "orchestration_type": "intelligent",
      "enhanced_tasks": [
        {
          "task_id": "task_001",
          "type": "enhanced_search",
          "description": "基于用户偏好的智能文档搜索",
          "agenticx_tools": ["memory_retrieval", "context_enhancement"],
          "parameters": {
            "original_query": "机器学习文档",
            "enhanced_query": "机器学习 深度学习 神经网络 算法",
            "user_context": "技术文档偏好"
          }
        }
      ]
    },
    "memory_updated": true
  },
  "message": "意图分析完成",
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456789"
}
```

**澄清场景响应示例**:

```json
{
  "success": true,
  "data": {
    "request_id": "req_12346",
    "session_id": "sess_002",
    "is_need_clarify": true,
    "clarify_query": "您想要搜索哪个具体领域的文档？比如：技术文档、学术论文、还是教程资料？",
    "clarify_reason": "意图模糊：搜索范围过于宽泛",
    "suggestions": [
      "技术文档",
      "学术论文",
      "教程资料",
      "API文档"
    ],
    "enhanced_result": {
      "original_intent_result": {
        "intentions": [
          {
            "type": "search",
            "confidence": 0.45,
            "entities": {
              "keywords": ["文档"],
              "document_type": "unknown"
            }
          }
        ]
      },
      "agenticx_enhancements": {
        "clarification_analysis": {
          "missing_entities": ["document_type", "specific_domain"],
          "ambiguous_intents": ["search_scope_unclear"],
          "confidence_threshold": 0.7,
          "actual_confidence": 0.45
        }
      }
    },
    "workflow_plan": null,
    "memory_updated": true
  },
  "message": "需要澄清用户意图",
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456790"
}
```

### 2.2 澄清生成接口

#### POST /api/v1/agenticx/clarify

基于意图识别结果生成澄清问题，用于处理模糊意图或实体缺失的情况。

**请求参数**:

```json
{
  "intent_result": {
    "intentions": [
      {
        "type": "search",
        "confidence": 0.45,
        "entities": {
          "keywords": ["文档"],
          "document_type": "unknown"
        }
      }
    ]
  },
  "user_context": {
    "user_id": "user123",
    "session_id": "sess_002",
    "previous_queries": ["帮我找资料"]
  },
  "clarify_type": "auto"
}
```

**参数说明**:

| 参数名                     | 类型     | 必填 | 说明                           |
| ------------------------ | ------ | -- | ---------------------------- |
| intent\_result           | object | 是  | 意图识别结果                       |
| intent\_result.intentions | array  | 是  | 意图列表                         |
| user\_context            | object | 否  | 用户上下文信息                      |
| clarify\_type            | string | 否  | 澄清类型：auto/intent/entity，默认auto |

**响应示例**:

```json
{
  "success": true,
  "data": {
    "is_need_clarify": true,
    "clarify_query": "您想要搜索哪个具体领域的文档？比如：技术文档、学术论文、还是教程资料？",
    "clarify_reason": "意图模糊：搜索范围过于宽泛，实体缺失：document_type",
    "suggestions": [
      "技术文档",
      "学术论文",
      "教程资料",
      "API文档"
    ],
    "clarify_type": "entity_missing",
    "missing_entities": ["document_type", "specific_domain"],
    "confidence_analysis": {
      "threshold": 0.7,
      "actual": 0.45,
      "reason": "置信度低于阈值"
    }
  },
  "message": "澄清内容生成成功",
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456791"
}
```

### 2.3 执行计划

#### POST /api/v1/plan/execute

执行指定的计划。

**请求参数**:

```json
{
  "plan_id": "plan_456",
  "user_id": "user123",
  "execution_options": {
    "async_mode": true,
    "callback_url": "https://your-app.com/webhook/execution",
    "timeout": 300
  }
}
```

**响应示例**:

```json
{
  "success": true,
  "data": {
    "execution_id": "exec_789",
    "status": "running",
    "started_at": "2024-01-01T12:00:00Z",
    "estimated_completion": "2024-01-01T12:00:07Z",
    "progress": {
      "completed_tasks": 0,
      "total_tasks": 2,
      "current_task": "task_1",
      "percentage": 0
    }
  },
  "message": "计划执行已开始",
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456790"
}
```

### 2.3 查询执行状态

#### GET /api/v1/execution/{execution\_id}/status

查询计划执行状态。

**路径参数**:

| 参数名           | 类型     | 说明   |
| ------------- | ------ | ---- |
| execution\_id | string | 执行ID |

**响应示例**:

```json
{
  "success": true,
  "data": {
    "execution_id": "exec_789",
    "status": "completed",
    "started_at": "2024-01-01T12:00:00Z",
    "completed_at": "2024-01-01T12:00:06Z",
    "duration": 6.2,
    "progress": {
      "completed_tasks": 2,
      "total_tasks": 2,
      "percentage": 100
    },
    "results": [
      {
        "task_id": "task_1",
        "status": "completed",
        "output": {
          "found_images": [
            {
              "file_id": "img_001",
              "file_name": "photo_20240101_001.jpg",
              "file_path": "/storage/images/2024/01/01/photo_20240101_001.jpg",
              "created_at": "2024-01-01T15:30:00Z",
              "size": 2048576
            }
          ],
          "total_count": 1
        },
        "duration": 2.1
      },
      {
        "task_id": "task_2",
        "status": "completed",
        "output": {
          "processed_image": {
            "file_id": "img_001_enhanced",
            "file_name": "photo_20240101_001_enhanced.jpg",
            "file_path": "/storage/processed/photo_20240101_001_enhanced.jpg",
            "original_file_id": "img_001",
            "enhancement_type": "ai_beauty",
            "processing_time": 4.1
          }
        },
        "duration": 4.1
      }
    ]
  },
  "message": "执行已完成",
  "timestamp": "2024-01-01T12:00:06Z",
  "request_id": "req_123456791"
}
```

### 2.4 一键分析并执行

#### POST /api/v1/intent/analyze-and-execute

分析意图并立即执行计划。

**请求参数**:

```json
{
  "input": "帮我找一下昨天拍的照片，然后用AI美化一下",
  "user_id": "user123",
  "context": {
    "session_id": "session456"
  },
  "execution_options": {
    "async_mode": false,
    "timeout": 300
  }
}
```

**响应示例**:

```json
{
  "success": true,
  "data": {
    "analysis_id": "analysis_790",
    "execution_id": "exec_790",
    "intent_analysis": {
      "intentions": [...],
      "workflow_type": "sequential",
      "overall_confidence": 0.93
    },
    "execution_result": {
      "status": "completed",
      "duration": 6.2,
      "results": [...]
    }
  },
  "message": "分析和执行完成",
  "timestamp": "2024-01-01T12:00:06Z",
  "request_id": "req_123456792"
}
```

## 3. 管理API端点

### 3.1 用户会话管理

#### GET /api/v1/users/{user\_id}/sessions

获取用户的会话列表。

**响应示例**:

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "session_id": "session456",
        "created_at": "2024-01-01T10:00:00Z",
        "last_activity": "2024-01-01T12:00:00Z",
        "interaction_count": 5,
        "status": "active"
      }
    ],
    "total_count": 1,
    "page": 1,
    "page_size": 20
  }
}
```

#### GET /api/v1/sessions/{session\_id}/history

获取会话的交互历史。

**响应示例**:

```json
{
  "success": true,
  "data": {
    "execution_id": "exec_789",
    "status": "running",
    "started_at": "2024-01-01T12:00:00Z",
    "estimated_completion": "2024-01-01T12:00:07Z",
    "progress": {
      "completed_tasks": 0,
      "total_tasks": 2,
      "current_task": "task_1",
      "percentage": 0
    }
  },
  "message": "计划执行已开始",
  "timestamp": "2024-01-01T12:00:00Z",
  "request_id": "req_123456790"
}
```

### 3.2 系统监控

#### GET /api/v1/system/health

系统健康检查。

**响应示例**:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "components": {
      "vllm_engine": {
        "status": "healthy",
        "gpu_usage": 0.75,
        "memory_usage": 0.68
      },
      "memory_system": {
        "status": "healthy",
        "connection_pool": 8
      },
      "tool_executor": {
        "status": "healthy",
        "active_tasks": 2
      }
    },
    "uptime": 86400,
    "version": "1.0.0"
  }
}
```

#### GET /api/v1/system/metrics

系统性能指标。

**响应示例**:

```json
{
  "success": true,
  "data": {
    "metrics": {
      "intent_recognition_accuracy": 0.92,
      "average_processing_time": 2.5,
      "workflow_success_rate": 0.95,
      "total_requests": 1000,
      "requests_per_minute": 15.2
    },
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

## 4. WebSocket实时API

### 4.1 连接端点

**WebSocket URL**: `ws://localhost:8000/ws/intent/{user_id}`

### 4.2 消息格式

#### 客户端发送消息

```json
{
  "type": "intent_analysis",
  "data": {
    "input": "帮我找一下昨天拍的照片",
    "context": {
      "session_id": "session456"
    }
  },
  "message_id": "msg_001"
}
```

#### 服务端响应消息

```json
{
  "type": "intent_analysis_result",
  "data": {
    "analysis_id": "analysis_789",
    "intent_analysis": {...},
    "execution_plan": {...}
  },
  "message_id": "msg_001",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

#### 执行进度推送

```json
{
  "type": "execution_progress",
  "data": {
    "execution_id": "exec_789",
    "progress": {
      "completed_tasks": 1,
      "total_tasks": 2,
      "current_task": "task_2",
      "percentage": 50
    }
  },
  "timestamp": "2024-01-01T12:00:03Z"
}
```

## 5. 错误代码

### 5.1 通用错误代码

| 错误代码             | HTTP状态码 | 说明      |
| ---------------- | ------- | ------- |
| INVALID\_REQUEST | 400     | 请求参数无效  |
| UNAUTHORIZED     | 401     | 未授权访问   |
| FORBIDDEN        | 403     | 禁止访问    |
| NOT\_FOUND       | 404     | 资源不存在   |
| RATE\_LIMITED    | 429     | 请求频率超限  |
| INTERNAL\_ERROR  | 500     | 服务器内部错误 |

### 5.2 业务错误代码

| 错误代码                      | HTTP状态码 | 说明     |
| ------------------------- | ------- | ------ |
| INTENT\_ANALYSIS\_FAILED  | 422     | 意图分析失败 |
| MODEL\_INFERENCE\_TIMEOUT | 408     | 模型推理超时 |
| PLAN\_GENERATION\_FAILED  | 422     | 计划生成失败 |
| EXECUTION\_FAILED         | 422     | 执行失败   |
| TOOL\_NOT\_AVAILABLE      | 503     | 工具不可用  |
| MEMORY\_STORAGE\_ERROR    | 500     | 记忆存储错误 |

## 6. SDK示例

### 6.1 Python SDK

```python
import asyncio
from agenticx_intent_client import IntentClient

async def main():
    # 初始化客户端
    client = IntentClient(
        base_url="http://localhost:8000",
        api_key="your_api_key"  # 可选
    )
    
    # 分析意图
    result = await client.analyze_intent(
        input_text="帮我找一下昨天拍的照片，然后用AI美化一下",
        user_id="user123",
        context={"session_id": "session456"}
    )
    
    print(f"识别的意图: {result.intentions}")
    
    # 执行计划
    if result.execution_plan:
        execution = await client.execute_plan(
            plan_id=result.execution_plan.plan_id,
            user_id="user123"
        )
        
        # 等待执行完成
        final_result = await client.wait_for_completion(
            execution_id=execution.execution_id,
            timeout=300
        )
        
        print(f"执行结果: {final_result.status}")

if __name__ == "__main__":
    asyncio.run(main())
```

### 6.2 JavaScript SDK

```javascript
import { IntentClient } from '@agenticx/intent-client';

const client = new IntentClient({
  baseUrl: 'http://localhost:8000',
  apiKey: 'your_api_key' // 可选
});

async function analyzeAndExecute() {
  try {
    // 分析并执行
    const result = await client.analyzeAndExecute({
      input: '帮我找一下昨天拍的照片，然后用AI美化一下',
      userId: 'user123',
      context: { sessionId: 'session456' }
    });
    
    console.log('执行结果:', result.executionResult);
  } catch (error) {
    console.error('执行失败:', error.message);
  }
}

analyzeAndExecute();
```

## 7. 部署说明

### 7.1 Docker部署

```dockerfile
# Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "main.py"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  intent-agent:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/agenticx
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./models:/app/models
      - ./config:/app/config
    depends_on:
      - db
      - redis
  
  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=agenticx
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    
volumes:
  postgres_data:
```

### 7.2 环境变量

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/agenticx
REDIS_URL=redis://localhost:6379
API_KEY=your_secret_api_key
LOG_LEVEL=INFO
GPU_MEMORY_UTILIZATION=0.8
MAX_CONCURRENT_REQUESTS=10
```

这个API文档提供了完整的接口规范，支持同步和异步操作，包含了实时WebSocket通信，以及完整的错误处理和监控功能。
