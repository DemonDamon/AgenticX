# Dockerfile for hi-agent
# Uses AgentKit base image (veadk + agentkit pre-installed)
FROM agentkit-prod-public-cn-beijing.cr.volces.com/base/py-simple:python3.12-bookworm-slim-latest

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

WORKDIR /app

# Copy project files only (no pip install needed)
COPY . .

CMD ["python", "-m", "wrapper"]
