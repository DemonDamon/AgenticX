#!/usr/bin/env python3
"""
启动「每日灵感助手」流式 API 服务

用法:
  cd examples/simple_chat_agent
  python serve.py

  或指定端口:
  python serve.py --port 9000

环境变量（.env）:
  - BAILIAN_API_KEY / BAILIAN_API_BASE / BAILIAN_CHAT_MODEL  百炼模型
  - OPENAI_API_KEY  OpenAI 模型
"""

import argparse
import sys
from pathlib import Path

# 加载同目录下的 .env
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

# 确保 agenticx 在 path 中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from agenticx.server import AgentServer, register_api_routes
from agenticx.server.middleware import register_production_middlewares, MiddlewareConfig

from agent import stream_handler


def main():
    parser = argparse.ArgumentParser(description="每日灵感助手 API 服务")
    parser.add_argument("--port", "-p", type=int, default=8000, help="监听端口")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址")
    args = parser.parse_args()

    app = AgentServer(
        stream_handler=stream_handler,
        model_name="inspiration",
        title="每日灵感助手",
    ).app
    register_production_middlewares(app, MiddlewareConfig())
    register_api_routes(app)

    import uvicorn
    print(f"每日灵感助手 API: http://{args.host}:{args.port}")
    print("  流式对话: POST /v1/chat/completions (stream=true)")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
