package moderation

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	policyengine "github.com/agenticx/enterprise/policy-engine"
)

// Service 是内容安全审核的执行入口：按租户配置外呼 provider，
// 把结论合成为 policyengine.HitEvent（带 category），降级语义在 Enforce 内闭环。
type Service struct {
	config *ConfigLoader
	logger *slog.Logger
}

func NewService(config *ConfigLoader, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	return &Service{config: config, logger: logger}
}

// Result 是一次审核的结论。Checked=false 表示未配置/未启用（现状等价）。
type Result struct {
	Checked   bool
	Blocked   bool
	Degraded  bool // provider 故障且 degraded 模式：放行但已请求 CRITICAL 告警
	Hit       policyengine.HitEvent
	Category  string
}

func (s *Service) ConfigLoader() *ConfigLoader { return s.config }

func (s *Service) blockSeverity(cfg TenantConfig) string {
	sev := strings.TrimSpace(cfg.BlockSeverity)
	if sev == "" {
		return "critical"
	}
	return sev
}

// Enforce 对一段文本执行租户配置的内容安全审核。
//
// 降级语义（对齐 MASTER-PLAN 统一纪律 3）：
//   - provider 故障 + degraded（默认）：不阻断（本地合规规则仍在 evaluatePolicy 生效），
//     返回 Degraded=true，由调用方发 CRITICAL 告警；
//   - provider 故障 + strict（租户选装）：fail-closed 合成 block hit；
//   - 未配置/未启用：Checked=false，零行为变化。
func (s *Service) Enforce(ctx context.Context, tenantID, stage, text string) Result {
	cfg, ok := s.config.Config(tenantID)
	if !ok || !cfg.Enabled || strings.TrimSpace(cfg.Provider.URL) == "" ||
		(cfg.Provider.Type != "" && cfg.Provider.Type != "http") {
		return Result{}
	}
	provider := NewHTTPProvider(cfg.Provider.Name, cfg.Provider.URL, cfg.Provider.APIKey, cfg.Timeout())
	callCtx, cancel := context.WithTimeout(ctx, cfg.Timeout())
	defer cancel()
	verdict, err := provider.Check(callCtx, CheckRequest{
		TenantID:   tenantID,
		Stage:      stage,
		Text:       text,
		Categories: cfg.Categories,
	})
	if err != nil {
		s.logger.Warn("moderation provider failed",
			"tenant", tenantID, "provider", provider.Name(), "stage", stage, "error", err)
		if cfg.Strict() {
			return Result{
				Checked:  true,
				Blocked:  true,
				Degraded: true,
				Category: "moderation",
				Hit: policyengine.HitEvent{
					RuleID:   "moderation_strict_fail_closed",
					Kind:     "moderation",
					Action:   policyengine.ActionBlock,
					Severity: s.blockSeverity(cfg),
					Message:  "内容安全服务不可用，strict 模式已拦截",
					Matched:  "moderation",
					Stage:    stage,
					Category: "moderation",
				},
			}
		}
		return Result{Checked: true, Degraded: true}
	}
	if !verdict.Blocked {
		return Result{Checked: true}
	}
	category := "moderation"
	if len(verdict.Categories) > 0 {
		category = strings.TrimSpace(verdict.Categories[0])
		if category == "" {
			category = "moderation"
		}
	}
	message := fmt.Sprintf("内容安全审核拦截（类别：%s）", category)
	if verdict.Detail != "" {
		message = message + "：" + verdict.Detail
	}
	return Result{
		Checked:  true,
		Blocked:  true,
		Category: category,
		Hit: policyengine.HitEvent{
			RuleID:   "moderation_" + provider.Name(),
			Kind:     "moderation",
			Action:   policyengine.ActionBlock,
			Severity: s.blockSeverity(cfg),
			Message:  message,
			Matched:  category,
			Stage:    stage,
			Category: category,
		},
	}
}
