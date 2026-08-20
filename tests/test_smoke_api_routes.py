"""Frontend-compatible API endpoints smoke tests.

Tests core functionality of frontend-compatible API endpoints:
- POST /chat returns SSE stream
- POST /chat/{project_id} returns 201
- DELETE /chat/{project_id}/skip-task returns 201
- PUT /task/{project_id} updates task
- POST /task/{project_id}/start starts task

Author: Damon Li
"""

import asyncio  # type: ignore
import json  # type: ignore

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


async def _first_sse_frame(app, payload: dict, *, timeout: float = 8.0) -> tuple[int, str]:
    """直接驱动 ASGI 应用，取 SSE 的第一帧。

    为什么不用 TestClient：它和 httpx 的 ASGITransport 都会把响应体读完才返回，而
    /chat 的 SSE 流没有终点（没事件时每 timeout 秒发一个 sync 心跳，见
    sse_adapter.create_sse_stream）。两者在这个接口上都只会挂住——这条用例之所以能把
    整轮 `pytest tests/` 卡死，就是这个原因，不是接口坏了：真实 uvicorn 下首字节 5ms
    就到。

    receive 的写法是关键：先给一次请求体，之后**阻塞**等断开。starlette 的
    listen_for_disconnect 会一直 await receive()，如果它每次都立刻返回，就成了一个把
    事件循环饿死的死循环，连 http.response.start 都发不出来。
    """
    body = json.dumps(payload).encode()
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "path": "/chat", "raw_path": b"/chat",
        "query_string": b"", "root_path": "", "scheme": "http",
        "server": ("testserver", 80), "client": ("testclient", 123),
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
    }
    sent_body = False
    disconnect = asyncio.Event()

    async def receive():
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}
        await disconnect.wait()
        return {"type": "http.disconnect"}

    status = 0
    chunk = ""
    got_frame = asyncio.Event()

    async def send(message):
        nonlocal status, chunk
        if message["type"] == "http.response.start":
            status = int(message["status"])
        elif message["type"] == "http.response.body" and message.get("body"):
            chunk = message["body"].decode("utf-8", errors="ignore")
            got_frame.set()

    task = asyncio.create_task(app(scope, receive, send))
    try:
        await asyncio.wait_for(got_frame.wait(), timeout=timeout)
    finally:
        disconnect.set()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    return status, chunk

def test_health_endpoint(client):
    """测试 GET /health"""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "agenticx"


@pytest.mark.asyncio
async def test_start_chat_endpoint(app):
    """测试 POST /chat 返回 SSE 流，且首帧就是 confirmed。"""
    status, chunk = await _first_sse_frame(
        app,
        {
            "project_id": "test_project_1",
            "task_id": "task_1",
            "question": "Test question",
            "model_platform": "openai",
            "email": "test@example.com",
            "model_type": "gpt-4",
            "api_key": "test_key",
        },
    )

    assert status == 200
    assert chunk.startswith("data: ")
    # 首帧必须是 confirmed：这是「已收到、开始处理」的回执，前端靠它把输入框从
    # 等待态切出来。心跳 sync 也是合法帧，但不该排在 confirmed 前面。
    assert '"step": "confirmed"' in chunk
    assert "Test question" in chunk


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


@pytest.mark.asyncio
async def test_multiple_chat_requests(app):
    """测试多个聊天请求（多轮对话）：同一 project 连续两轮都能拿到 confirmed 首帧。"""
    project_id = "test_project_7"

    status1, chunk1 = await _first_sse_frame(
        app,
        {
            "project_id": project_id,
            "task_id": "task_1",
            "question": "First question",
            "model_platform": "openai",
            "email": "test@example.com",
            "model_type": "gpt-4",
            "api_key": "test_key",
        },
    )
    assert status1 == 200
    assert "First question" in chunk1

    status2, chunk2 = await _first_sse_frame(
        app,
        {
            "project_id": project_id,
            "task_id": "task_2",
            "question": "Second question",
            "model_platform": "openai",
            "email": "test@example.com",
            "model_type": "gpt-4",
            "api_key": "test_key",
        },
    )
    assert status2 == 200
    assert "Second question" in chunk2
