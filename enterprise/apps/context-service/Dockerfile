# 窄服务镜像：只拷统一上下文服务用得到的核心仓子包。
#
# 不要图省事改成 `pip install agenticx`——那会拖进 openai/tiktoken/tokenizers
# 全家桶。这里检索（chromadb）与 embedding（litellm）是本职，其余能省则省。
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY enterprise/apps/context-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# agenticx 只拷需要的子包，--no-deps 的效果靠这个实现：源码在，重依赖不在。
COPY agenticx/__init__.py /app/agenticx/__init__.py
COPY agenticx/core /app/agenticx/core
COPY agenticx/brain /app/agenticx/brain
COPY agenticx/studio/__init__.py /app/agenticx/studio/__init__.py
COPY agenticx/studio/kb /app/agenticx/studio/kb
COPY agenticx/knowledge /app/agenticx/knowledge
COPY agenticx/tools /app/agenticx/tools
COPY agenticx/embeddings /app/agenticx/embeddings
COPY agenticx/llms /app/agenticx/llms
COPY agenticx/code_index /app/agenticx/code_index
COPY agenticx/utils /app/agenticx/utils

COPY enterprise/apps/context-service/context_service /app/context_service

# 共享产物目录由编排层挂载到 /data；进程不该有写系统目录的权限。
RUN useradd --create-home --uid 10001 context && chown -R context:context /app
USER context

EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8091/healthz').status==200 else 1)"

CMD ["uvicorn", "context_service.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8091"]
