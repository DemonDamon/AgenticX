# 托管运行时：复用 agenticx 框架的 AgentRuntime 与托管宿主，会话事件落企业 PG，模型调用经企业网关。
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/data/home \
    MA_RUNTIME_HOME=/data/home \
    MA_RUNTIME_COMMAND_SANDBOX=required \
    AGX_LEARNING_ENABLED=0 \
    AGX_SESSION_FTS=0 \
    AGX_SKILL_MANAGE=0

RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates git build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY pyproject.toml README.md LICENSE /src/
COPY agenticx /src/agenticx
RUN pip install --no-cache-dir "/src[mcp]"

COPY enterprise/apps/agent-runtime/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY enterprise/apps/agent-runtime/ma_agent_runtime /app/ma_agent_runtime

RUN useradd --create-home --uid 10002 agentrt \
 && mkdir -p /data/home \
 && chown -R agentrt:agentrt /app /data
USER agentrt
WORKDIR /app

EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8092/healthz').status==200 else 1)"

CMD ["uvicorn", "ma_agent_runtime.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8092"]
