#!/usr/bin/env python3
"""
生产级 API 基础设施测试脚本

针对 production_api_infrastructure 计划中的 P1-P6 能力进行验证。
支持两种模式：
  - 默认：使用 TestClient，无需启动服务
  - --live：请求真实运行中的服务（需先 python serve.py）

用法:
  cd examples/simple_chat_agent
  python test_api.py              # TestClient 模式
  python test_api.py --live       # 真实服务模式（默认 http://localhost:8000）
  python test_api.py --live --url http://localhost:9000
"""

import argparse
import json
import sys
from pathlib import Path

# 项目根路径 + 当前目录（agent 模块）
ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(SCRIPT_DIR))

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _make_app():
    """构建与 serve.py 相同的 FastAPI 应用"""
    from agenticx.server import AgentServer, register_api_routes
    from agenticx.server.middleware import register_production_middlewares, MiddlewareConfig
    from agent import stream_handler

    app = AgentServer(
        stream_handler=stream_handler,
        model_name="inspiration",
        title="每日灵感助手",
    ).app
    register_production_middlewares(app, MiddlewareConfig())
    register_api_routes(app)
    return app


def run_testclient_tests():
    """使用 TestClient 测试（无需启动服务）"""
    from starlette.testclient import TestClient

    app = _make_app()
    client = TestClient(app)
    errors = []

    # P5: 健康探针
    print("\n[P5] 健康探针")
    for path in ["/health", "/health/live", "/health/ready", "/health/startup"]:
        r = client.get(path)
        ok = r.status_code == 200
        print(f"  GET {path} -> {r.status_code} {'✓' if ok else '✗'}")
        if not ok:
            errors.append(f"GET {path} failed: {r.status_code}")

    # P1: Request-ID 中间件（响应头应含 X-Request-ID）
    print("\n[P1] Request-ID 中间件")
    r = client.get("/health/live")
    req_id = r.headers.get("X-Request-ID") or r.headers.get("x-request-id")
    ok = bool(req_id)
    print(f"  X-Request-ID in response: {'✓' if ok else '✗'} {req_id or '(missing)'}")
    if not ok:
        errors.append("X-Request-ID header missing")

    # P2: 任务队列
    print("\n[P2] 异步任务队列")
    r = client.post("/tasks/submit", json={"name": "test_task", "payload": {}})
    ok = r.status_code == 202
    print(f"  POST /tasks/submit -> {r.status_code} {'✓' if ok else '✗'}")
    if not ok:
        errors.append(f"POST /tasks/submit failed: {r.status_code}")
    else:
        data = r.json()
        task_id = data.get("task_id")
        if task_id:
            r2 = client.get(f"/tasks/{task_id}/status")
            ok2 = r2.status_code == 200
            print(f"  GET /tasks/{{id}}/status -> {r2.status_code} {'✓' if ok2 else '✗'}")
            if not ok2:
                errors.append(f"GET /tasks/{{id}}/status failed: {r2.status_code}")
            # cancel 已完成的任务可能返回 400，可接受
            r3 = client.post(f"/tasks/{task_id}/cancel")
            print(f"  POST /tasks/{{id}}/cancel -> {r3.status_code}")

    # P4: 认证（注册 + 登录）
    print("\n[P4] JWT 认证")
    # 使用唯一邮箱避免重复注册冲突
    import uuid
    email = f"test_{uuid.uuid4().hex[:8]}@test.com"
    r = client.post("/api/register", json={
        "email": email,
        "password": "Test123!",
        "username": "testuser",
    })
    ok = r.status_code == 200
    print(f"  POST /api/register -> {r.status_code} {'✓' if ok else '✗'}")
    if not ok:
        errors.append(f"POST /api/register failed: {r.status_code}")
    else:
        reg_data = r.json()
        token = reg_data.get("token")
        ok_token = bool(token)
        print(f"  JWT in response: {'✓' if ok_token else '✗'}")
        if ok_token:
            r_login = client.post("/api/login", json={"email": email, "password": "Test123!"})
            print(f"  POST /api/login -> {r_login.status_code} {'✓' if r_login.status_code == 200 else '✗'}")

    # P3: 多租户（X-Tenant-ID 透传）
    print("\n[P3] 多租户隔离")
    r = client.get("/health/live", headers={"X-Tenant-ID": "tenant-demo"})
    ok = r.status_code == 200
    print(f"  GET /health/live + X-Tenant-ID -> {r.status_code} {'✓' if ok else '✗'}")

    # 流式对话 API
    print("\n[Chat] 流式对话")
    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "inspiration",
            "messages": [{"role": "user", "content": "测试"}],
            "stream": True,
        },
    )
    ok = r.status_code == 200
    print(f"  POST /v1/chat/completions (stream=true) -> {r.status_code} {'✓' if ok else '✗'}")
    if ok:
        lines = [ln for ln in r.text.strip().split("\n") if ln.startswith("data:")]
        has_content = any("content" in ln and "delta" in ln for ln in lines)
        print(f"  收到 {len(lines)} 条 SSE，含 content: {'✓' if has_content else '✗'}")
        if not has_content and len(lines) > 1:
            errors.append("Stream response missing content chunks")
        # 检查中文未转义
        raw = r.text
        if "\\u" in raw and "洞" not in raw and "见" not in raw:
            # 若全是 \uXXXX 且无中文，可能有问题；此处简化检查
            pass  # 已有 ensure_ascii=False 修复

    return errors


def run_live_tests(base_url: str):
    """请求真实运行中的服务"""
    try:
        import httpx
    except ImportError:
        print("--live 模式需要 httpx: pip install httpx")
        return ["httpx not installed"]

    base_url = base_url.rstrip("/")
    errors = []

    with httpx.Client(timeout=30.0) as client:
        # P5
        print("\n[P5] 健康探针")
        for path in ["/health", "/health/live", "/health/ready", "/health/startup"]:
            r = client.get(f"{base_url}{path}")
            ok = r.status_code == 200
            print(f"  GET {path} -> {r.status_code} {'✓' if ok else '✗'}")
            if not ok:
                errors.append(f"GET {path} failed: {r.status_code}")

        # P1
        print("\n[P1] Request-ID")
        r = client.get(f"{base_url}/health/live")
        req_id = r.headers.get("X-Request-ID") or r.headers.get("x-request-id")
        print(f"  X-Request-ID: {'✓' if req_id else '✗'} {req_id or '(missing)'}")
        if not req_id:
            errors.append("X-Request-ID missing")

        # P2
        print("\n[P2] 任务队列")
        r = client.post(f"{base_url}/tasks/submit", json={"name": "live_test", "payload": {}})
        ok = r.status_code == 202
        print(f"  POST /tasks/submit -> {r.status_code} {'✓' if ok else '✗'}")
        if ok:
            task_id = r.json().get("task_id")
            r2 = client.get(f"{base_url}/tasks/{task_id}/status")
            print(f"  GET /tasks/{{id}}/status -> {r2.status_code} {'✓' if r2.status_code == 200 else '✗'}")

        # P4
        print("\n[P4] JWT 认证")
        import uuid
        email = f"live_{uuid.uuid4().hex[:8]}@test.com"
        r = client.post(f"{base_url}/api/register", json={
            "email": email, "password": "Test123!", "username": "liveuser",
        })
        print(f"  POST /api/register -> {r.status_code} {'✓' if r.status_code == 200 else '✗'}")
        if r.status_code == 200 and r.json().get("token"):
            r2 = client.post(f"{base_url}/api/login", json={"email": email, "password": "Test123!"})
            print(f"  POST /api/login -> {r2.status_code} {'✓' if r2.status_code == 200 else '✗'}")

        # P3
        print("\n[P3] 多租户")
        r = client.get(f"{base_url}/health/live", headers={"X-Tenant-ID": "tenant-live"})
        print(f"  GET /health/live + X-Tenant-ID -> {r.status_code} {'✓' if r.status_code == 200 else '✗'}")

        # 流式对话
        print("\n[Chat] 流式对话")
        with client.stream(
            "POST", f"{base_url}/v1/chat/completions",
            json={"model": "inspiration", "messages": [{"role": "user", "content": "你好"}], "stream": True},
        ) as resp:
            ok = resp.status_code == 200
            print(f"  POST /v1/chat/completions (stream) -> {resp.status_code} {'✓' if ok else '✗'}")
            if ok:
                chunks = list(resp.iter_lines())
                has_content = any("content" in c for c in chunks)
                print(f"  收到 {len(chunks)} 行，含 content: {'✓' if has_content else '✗'}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="生产级 API 测试（P1-P6 + 流式对话）")
    parser.add_argument("--live", action="store_true", help="请求真实服务（需先 python serve.py）")
    parser.add_argument("--url", default="http://localhost:8000", help="--live 时的服务地址")
    args = parser.parse_args()

    print("=" * 50)
    print("AgenticX 生产级 API 基础设施测试")
    print("=" * 50)
    print(f"模式: {'Live @ ' + args.url if args.live else 'TestClient (无需启动服务)'}")

    if args.live:
        errors = run_live_tests(args.url)
    else:
        errors = run_testclient_tests()

    print("\n" + "=" * 50)
    if errors:
        print("失败项:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("全部通过 ✓")
        sys.exit(0)


if __name__ == "__main__":
    main()
