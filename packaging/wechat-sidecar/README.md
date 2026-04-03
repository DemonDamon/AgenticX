# WeChat iLink sidecar (`agx-wechat-sidecar`)

HTTP bridge for **personal WeChat (iLink)** used by Machi Desktop (`start-wechat-sidecar` / IPC). Prebuilt binaries are **not** checked into Git; build them locally.

## First-time setup

1. Install [Go](https://go.dev/dl/) **1.22+** (see `go.mod`).
2. From this directory:

```bash
cd packaging/wechat-sidecar
make build
```

This produces `./agx-wechat-sidecar` (current OS/arch). Desktop dev expects that path by default.

## Other targets

- `make build-all` — cross-compile `agx-wechat-sidecar-darwin-arm64`, `-darwin-amd64`, `-linux-amd64`, and Windows `.exe` variants (see `Makefile`).
- `make clean` — remove local build artifacts.

Release / CI builds compile from source and copy artifacts into `desktop/bundled-backend/`; see `.github/workflows/build-desktop.yml`.
