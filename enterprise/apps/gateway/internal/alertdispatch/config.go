package alertdispatch

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

// ChannelConfig 描述一个出站告警通道。当前支持：
//   - type=webhook：通用 JSON POST（自有运维端点）
//   - type=feishu ：飞书群机器人 webhook（interactive 卡片）
type ChannelConfig struct {
	Type        string `json:"type"` // webhook | feishu
	URL         string `json:"url"`
	MinSeverity string `json:"minSeverity,omitempty"` // 默认 MEDIUM
}

// TenantAlertConfig 是单个租户的分发配置。
type TenantAlertConfig struct {
	Channels             []ChannelConfig `json:"channels"`
	DedupWindowSeconds   int             `json:"dedupWindowSeconds,omitempty"`   // 默认 600
	RateLimitPerMinute   int             `json:"rateLimitPerMinute,omitempty"`   // 默认 10，0=不限
}

type snapshot struct {
	tenants map[string]TenantAlertConfig
}

// ConfigLoader 后台轮询 alert-channels.json（admin-console 落盘），
// 提供原子快照查询。文件不存在 = 空配置（不分发，等价现状）。
type ConfigLoader struct {
	path    string
	logger  *slog.Logger
	current atomic.Pointer[snapshot]
}

const defaultAlertsFile = "alert-channels.json"

// NewConfigLoader 从 GATEWAY_ADMIN_ALERTS_FILE 读取路径；未设置时回退
// `${cwd}/.runtime/admin/alert-channels.json`。
func NewConfigLoader(logger *slog.Logger) *ConfigLoader {
	path := os.Getenv("GATEWAY_ADMIN_ALERTS_FILE")
	if path == "" {
		cwd, _ := os.Getwd()
		path = filepath.Join(cwd, ".runtime", "admin", defaultAlertsFile)
	}
	l := &ConfigLoader{path: path, logger: logger}
	l.current.Store(&snapshot{tenants: map[string]TenantAlertConfig{}})
	return l
}

// Start 立即加载一次并周期刷新；文件缺失/解析失败保持旧快照。
func (l *ConfigLoader) Start(stop <-chan struct{}) {
	if err := l.Reload(); err != nil {
		l.logger.Info("alert channels config not loaded yet", "path", l.path, "error", err)
	}
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if err := l.Reload(); err != nil {
					l.logger.Debug("reload alert channels config failed", "error", err)
				}
			}
		}
	}()
}

// Reload 强制重读配置文件。
func (l *ConfigLoader) Reload() error {
	raw, err := os.ReadFile(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			l.current.Store(&snapshot{tenants: map[string]TenantAlertConfig{}})
			return nil
		}
		return err
	}
	var parsed struct {
		Tenants map[string]TenantAlertConfig `json:"tenants"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return err
	}
	if parsed.Tenants == nil {
		parsed.Tenants = map[string]TenantAlertConfig{}
	}
	l.current.Store(&snapshot{tenants: parsed.Tenants})
	return nil
}

// Path 暴露配置路径（健康检查/排障用）。
func (l *ConfigLoader) Path() string { return l.path }

func (l *ConfigLoader) tenantConfig(tenantID string) (TenantAlertConfig, bool) {
	s := l.current.Load()
	if s == nil {
		return TenantAlertConfig{}, false
	}
	cfg, ok := s.tenants[tenantID]
	return cfg, ok
}

// Tenants 返回当前已配置的租户数（观测用）。
func (l *ConfigLoader) Tenants() int {
	s := l.current.Load()
	if s == nil {
		return 0
	}
	return len(s.tenants)
}

func (c TenantAlertConfig) dedupWindow() time.Duration {
	if c.DedupWindowSeconds > 0 {
		return time.Duration(c.DedupWindowSeconds) * time.Second
	}
	return 10 * time.Minute
}

func (c TenantAlertConfig) rateLimit() int {
	if c.RateLimitPerMinute > 0 {
		return c.RateLimitPerMinute
	}
	return 10
}
