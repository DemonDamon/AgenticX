# 构建（在仓库根目录下，BuildKit 会读取同级 Dockerfile.dockerignore）:
#   docker build -f enterprise/apps/gateway/Dockerfile .
# 如 gcr.io 在当前网络不可达，可通过 RUNTIME_IMAGE 指向已同步的 distroless 镜像。
ARG RUNTIME_IMAGE=gcr.io/distroless/static-debian12:nonroot
FROM golang:1.26-bookworm AS build

# go.mod replace 指向 ../../packages/policy-engine 和 ../../../connector-runtime
WORKDIR /work/enterprise/apps/gateway
COPY connector-runtime /work/connector-runtime
COPY enterprise/packages/policy-engine /work/enterprise/packages/policy-engine
COPY enterprise/apps/gateway/go.mod enterprise/apps/gateway/go.sum ./
RUN go mod download
COPY enterprise/apps/gateway/ ./

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /gateway ./cmd/gateway

FROM ${RUNTIME_IMAGE}
COPY --from=build /gateway /gateway
USER nonroot:nonroot
ENTRYPOINT ["/gateway"]
