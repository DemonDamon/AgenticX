// AgenticX Edge Agent — 端侧安全闭环 Sidecar
//
// 职责：
//  1. 本地模型推理代理（Ollama）
//  2. Workspace 沙箱路径管控
//  3. 审计摘要脱敏后异步上送
//
// 安全基线：
//  - 仅绑定 127.0.0.1
//  - 一次性 Token 鉴权
//  - 非 root 运行
//  - 日志 append-only + checksum 链
//
// 详见 README.md 与 docs/security-model.md
package main

import (
	"fmt"
	"os"
)

const Version = "0.1.0"

func main() {
	fmt.Fprintf(os.Stderr, "AgenticX Edge Agent v%s — skeleton\n", Version)
	fmt.Fprintln(os.Stderr, "🚧 TODO:")
	fmt.Fprintln(os.Stderr, "  1. internal/security: Token 生成与校验")
	fmt.Fprintln(os.Stderr, "  2. internal/api: HTTP server bind 127.0.0.1")
	fmt.Fprintln(os.Stderr, "  3. internal/sandbox: Workspace 路径白名单")
	fmt.Fprintln(os.Stderr, "  4. internal/ollama: Ollama 客户端")
	fmt.Fprintln(os.Stderr, "  5. internal/redact: PII / 自定义规则脱敏")
	fmt.Fprintln(os.Stderr, "  6. internal/uploader: 审计摘要异步上送")
}
