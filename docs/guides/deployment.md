# Deployment

## Overview

AgenticX can be deployed as:
- A standalone API server
- A Docker container
- A Docker Compose stack (with databases and vector stores)

## API Server

```bash
# Start the Studio API server
agx serve --port 8000 --host 0.0.0.0

# Or with uvicorn directly
uvicorn agenticx.server:app --host 0.0.0.0 --port 8000 --workers 4
```

## Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

ENV OPENAI_API_KEY=""
EXPOSE 8000

CMD ["agx", "serve", "--port", "8000", "--host", "0.0.0.0"]
```

```bash
docker build -t agenticx-app .
docker run -p 8000:8000 -e OPENAI_API_KEY=sk-... agenticx-app
```

## Docker Compose

The repo ships with ready-to-use Compose files in `deploy/`:

```bash
# Minimal setup (app + SQLite)
docker compose -f deploy/docker-compose.minimal.yml up

# Core setup (app + PostgreSQL + Redis)
docker compose -f deploy/docker-compose.core.yml up

# Full stack (+ Neo4j + vector stores)
docker compose -f deploy/docker-compose.yml up
```

## Environment Variables

Copy and configure the example env file:

```bash
cp deploy/env.example .env
# Edit .env with your values
```

Key variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `NEO4J_URI` | Neo4j connection URI |
| `AGX_MAX_TOOL_ROUNDS` | Max tool rounds per turn |
| `AGX_SECRET_KEY` | Session signing key |

## Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Health Check

```bash
curl http://localhost:8000/health
# {"status": "ok", "version": "0.x.x"}
```

## Scaling

For high-throughput deployments:

1. Run multiple workers: `uvicorn agenticx.server:app --workers 8`
2. Use Redis for session storage (instead of SQLite)
3. Use PostgreSQL for persistent data
4. Deploy behind a load balancer
5. Use Kubernetes for orchestration
