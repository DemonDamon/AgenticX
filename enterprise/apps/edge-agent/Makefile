BINARY := bin/edge-agent
PKG    := ./cmd/edge-agent

.PHONY: all build build-reproducible test vet vuln sbom clean

all: vet test build

build:
	@mkdir -p bin
	go build -o $(BINARY) $(PKG)

# Reproducible build（用于 release）
build-reproducible:
	@mkdir -p bin
	CGO_ENABLED=0 go build \
		-trimpath \
		-ldflags="-s -w -buildid=" \
		-o $(BINARY) $(PKG)

test:
	go test -race -cover ./...

vet:
	go vet ./...

# 安全扫描（需要 govulncheck 已安装）
vuln:
	@which govulncheck > /dev/null || \
		(echo "Install: go install golang.org/x/vuln/cmd/govulncheck@latest" && exit 1)
	govulncheck ./...

# SBOM 生成（需要 syft）
sbom: build-reproducible
	@which syft > /dev/null || \
		(echo "Install: brew install syft" && exit 1)
	syft $(BINARY) -o cyclonedx-json > $(BINARY).sbom.json
	@echo "✓ SBOM: $(BINARY).sbom.json"

clean:
	rm -rf bin/
