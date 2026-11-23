package alertdispatch

import "time"

// Alert 是进入分发管线的统一告警（来源：policy_hit / 预算告警 / 审计链自检失败）。
type Alert struct {
	TenantID  string
	Source    string // policy_hit | budget_alert | chain_check
	Severity  string // CRITICAL > HIGH > MEDIUM > LOW（未知按 MEDIUM）
	Title     string
	Summary   string
	TraceID   string
	SessionID string
	UserID    string
	Model     string
	DedupKey  string // 相同 key 在去重窗口内只发一条
	EventTime time.Time
}

// severityRank 返回可比较的严重度序号；未知值按 MEDIUM 处理。
func severityRank(sev string) int {
	switch normalizeSeverity(sev) {
	case "CRITICAL":
		return 4
	case "HIGH":
		return 3
	case "MEDIUM":
		return 2
	case "LOW":
		return 1
	}
	return 2
}

// NormalizeSeverity 统一大小写；空值与未知值回落 MEDIUM。
func NormalizeSeverity(sev string) string {
	return normalizeSeverity(sev)
}

// MaxSeverity 从若干 severity 字符串取最高档（policy_hit 多规则命中时定级用）。
func MaxSeverity(sevs []string) string {
	return maxSeverity(sevs)
}

func normalizeSeverity(sev string) string {
	switch sev {
	case "CRITICAL", "critical", "Critical":
		return "CRITICAL"
	case "HIGH", "high", "High":
		return "HIGH"
	case "MEDIUM", "medium", "Medium":
		return "MEDIUM"
	case "LOW", "low", "Low":
		return "LOW"
	}
	return "MEDIUM"
}

// maxSeverity 从若干 severity 字符串取最高档。
func maxSeverity(sevs []string) string {
	best := "LOW"
	bestRank := 0
	for _, s := range sevs {
		n := normalizeSeverity(s)
		if r := severityRank(n); r > bestRank {
			bestRank = r
			best = n
		}
	}
	if bestRank == 0 {
		return "MEDIUM"
	}
	return best
}
