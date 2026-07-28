# 构建（在仓库 `enterprise/` 目录下）:
#   docker build -f apps/gateway/Dockerfile .
# 如 gcr.io 在当前网络不可达，可通过 RUNTIME_IMAGE 指向已同步的 distroless 镜像。
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot
FROM golang:1.25-bookworm AS build

# go.mod replace 指向 ../../packages/policy-engine
WORKDIR /work/apps/gateway
COPY packages/policy-engine /work/packages/policy-engine
COPY apps/gateway/go.mod apps/gateway/go.sum ./
RUN go mod download
COPY apps/gateway/ ./

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gateway ./cmd/gateway

FROM ${RUNTIME_IMAGE}
COPY --from=build /gateway /gateway
USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
