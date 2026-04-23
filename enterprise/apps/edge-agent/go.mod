module github.com/agenticx/enterprise/edge-agent

go 1.22

// 依赖严格白名单策略：
// - 优先标准库
// - 业务依赖需在 docs/supply-chain.md 记录理由
// - 每次 release 前跑 govulncheck
