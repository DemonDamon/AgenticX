# 窄服务镜像：只装注册表与扫描器用得到的东西。
#
# 不要图省事改成 `pip install agenticx`——那会拖进 litellm / openai / tiktoken /
# tokenizers（Rust 轮子），镜像涨一个数量级，而这个服务一次模型调用都不发。
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY enterprise/apps/skill-registry/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# agenticx 只拷需要的子包，--no-deps 的效果靠这个实现：源码在，依赖不在。
COPY agenticx/__init__.py /app/agenticx/__init__.py
COPY agenticx/skills /app/agenticx/skills
COPY agenticx/extensions /app/agenticx/extensions
COPY agenticx/tools /app/agenticx/tools
COPY agenticx/core /app/agenticx/core

COPY enterprise/apps/skill-registry/skill_registry /app/skill_registry

# 不可信压缩包在这里解，进程不该有写系统目录的权限。
RUN useradd --create-home --uid 10001 registry && chown -R registry:registry /app
USER registry

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/healthz').status==200 else 1)"

CMD ["uvicorn", "skill_registry.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090"]
