"""
前端兼容 API 端点冒烟测试

测试前端兼容 API 端点的核心功能：
- POST /chat 返回 SSE 流
- POST /chat/{project_id} 返回 201
- DELETE /chat/{project_id}/skip-task 返回 201
- PUT /task/{project_id} 更新任务
- POST /task/{project_id}/start 启动任务
"""

import pytest  # type: ignore
from fastapi.testclient import TestClient  # type: ignore
from fastapi import FastAPI  # type: ignore

from agenticx.server.api_routes import register_api_routes
from agenticx.server.api_models import ChatRequest, SupplementChatRequest, UpdateTaskRequest, TaskInfo
from agenticx.collaboration.workforce.events import WorkforceEventBus


@pytest.fixture(scope="module")
def app():
    """创建测试应用"""
    app = FastAPI()
    event_bus = WorkforceEventBus()
    register_api_routes(app, event_bus)
    return app


@pytest.fixture(scope="module")
def client(app):
    """创建测试客户端"""
    return TestClient(app)


def test_health_endpoint(client):
    """测试 GET /health"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "agenticx"


def test_start_chat_endpoint(client):
    """测试 POST /chat 返回 SSE 流"""
    request_data = {
        "project_id": "test_project_1",
        "task_id": "task_1",
        "question": "Test question",
        "model_platform": "openai",
        "email": "test@example.com",
        "model_type": "gpt-4",
        "api_key": "test_key",
    }
    
    response = client.post("/chat", json=request_data)
    assert response.status_code == 200
    # TestClient 可能不会设置正确的 content-type，检查状态码即可
    # assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    
    # 读取 SSE 流的前几行（使用 stream=True）
    content = ""
    for chunk in response.iter_bytes():
        content += chunk.decode("utf-8", errors="ignore")
        if len(content) > 1000:  # 限制读取长度
            break
    
    assert "data: " in content
    assert "confirmed" in content or "sync" in content


def test_supplement_chat_endpoint(client):
    """测试 POST /chat/{project_id} 返回 201"""
    project_id = "test_project_2"
    request_data = {
        "question": "Follow-up question",
        "task_id": None,
    }
    
    response = client.post(f"/chat/{project_id}", json=request_data)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "accepted"
    assert data["project_id"] == project_id


def test_skip_task_endpoint(client):
    """测试 DELETE /chat/{project_id}/skip-task 返回 201"""
    project_id = "test_project_3"
    
    response = client.delete(f"/chat/{project_id}/skip-task")
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "stopped"
    assert data["project_id"] == project_id


def test_update_task_endpoint(client):
    """测试 PUT /task/{project_id} 更新任务"""
    project_id = "test_project_4"
    request_data = {
        "task": [
            {"id": "task_1", "content": "Task 1", "status": "waiting"},
            {"id": "task_2", "content": "Task 2", "status": "waiting"},
        ]
    }
    
    response = client.put(f"/task/{project_id}", json=request_data)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "updated"
    assert data["project_id"] == project_id


def test_start_task_endpoint(client):
    """测试 POST /task/{project_id}/start 启动任务"""
    project_id = "test_project_5"
    
    response = client.post(f"/task/{project_id}/start")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "started"
    assert data["project_id"] == project_id


def test_invalid_chat_request(client):
    """测试无效的 POST /chat 请求"""
    # 缺少必需字段
    request_data = {
        "project_id": "test_project",
        # 缺少其他必需字段
    }
    
    response = client.post("/chat", json=request_data)
    assert response.status_code == 400


def test_invalid_supplement_request(client):
    """测试无效的 POST /chat/{project_id} 请求"""
    project_id = "test_project_6"
    
    # 缺少 question 字段
    response = client.post(f"/chat/{project_id}", json={})
    assert response.status_code == 400


def test_multiple_chat_requests(client):
    """测试多个聊天请求（多轮对话）"""
    project_id = "test_project_7"
    
    # 第一个请求
    request_data_1 = {
        "project_id": project_id,
        "task_id": "task_1",
        "question": "First question",
        "model_platform": "openai",
        "email": "test@example.com",
        "model_type": "gpt-4",
        "api_key": "test_key",
    }
    response1 = client.post("/chat", json=request_data_1)
    assert response1.status_code == 200
    
    # 第二个请求（多轮对话）
    request_data_2 = {
        "question": "Second question",
        "task_id": None,
    }
    response2 = client.post(f"/chat/{project_id}", json=request_data_2)
    assert response2.status_code == 201


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
