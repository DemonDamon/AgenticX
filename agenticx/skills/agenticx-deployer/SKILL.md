---
name: agenticx-deployer
description: Guide for deploying AgenticX agents to production including Docker containerization, Kubernetes orchestration, Volcengine AgentKit cloud deployment, and API server setup. Use when the user wants to deploy agents, containerize applications, set up Kubernetes, configure cloud deployment, or run the AgenticX API server in production.
metadata:
  author: AgenticX
  version: "0.3.5"
---

# AgenticX Deployer

Guide for taking AgenticX agents from development to production.

## Deployment Options

| Method | Best For | Command |
|--------|----------|---------|
| API Server | Quick deployment, development | `agx serve` |
| Docker | Single-node, reproducible | `agx deploy docker` |
| Kubernetes | Multi-node, auto-scaling | `agx deploy k8s` |
| Volcengine | Cloud-native, managed | `agx volcengine deploy` |

## API Server

### Start Server

```bash
# Default (0.0.0.0:8000)
agx serve

# Custom port + host
agx serve --port 9000 --host 127.0.0.1

# Development with auto-reload
agx serve --port 8000 --reload
```

Requires: `pip install "agenticx[server]"`

### Health Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Comprehensive health check |
| `GET /health/live` | Liveness probe |
| `GET /health/ready` | Readiness probe |
| `POST /tasks/submit` | Submit a task |

## Docker Deployment

### Prepare & Build

```bash
# Prepare deployment package
agx deploy prepare --output ./deploy-package

# Build Docker image
agx deploy docker --tag my-agent:latest

# Run container
docker run -p 8000:8000 \
  -e OPENAI_API_KEY="sk-..." \
  my-agent:latest
```

### Custom Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["agx", "serve", "--port", "8000"]
```

## Kubernetes Deployment

```bash
# Generate K8s manifests
agx deploy k8s --output ./k8s-manifests

# Apply to cluster
kubectl apply -f ./k8s-manifests/
```

Generated manifests include:
- Deployment with health probes
- Service (ClusterIP)
- ConfigMap for non-sensitive config
- Secret template for API keys
- HPA for auto-scaling

## Volcengine AgentKit

Cloud-native deployment on Volcengine's managed platform.

Requires: `pip install "agenticx[volcengine]"`

### Setup

```bash
# Initialize project
agx volcengine init

# Configure credentials
agx volcengine config \
  --access-key YOUR_AK \
  --secret-key YOUR_SK \
  --region cn-beijing
```

### Deploy

```bash
# Deploy agent
agx volcengine deploy --agent my-agent

# Check status
agx volcengine status

# Invoke deployed agent
agx volcengine invoke --agent my-agent --input "Analyze this data"

# Tear down
agx volcengine destroy --agent my-agent
```

### Integration Info

```bash
agx volcengine info
```

## Monitoring in Production

```bash
# Start monitoring service
agx monitor start

# Check monitoring status
agx monitor status
```

AgenticX supports Prometheus metrics export for production monitoring.

## Pre-Deployment Checklist

1. **Environment variables** — all API keys set and not hardcoded
2. **Health probes** — `/health/live` and `/health/ready` configured
3. **Resource limits** — CPU/memory limits set in K8s/Docker
4. **Logging** — structured logging enabled
5. **Secrets** — use K8s Secrets or vault, never commit keys
6. **Testing** — run `agx test` before deploying
7. **Validation** — run `agx validate config.yaml` for config correctness
