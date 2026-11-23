package moderation

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

// ProviderConfig 描述一个第三方内容安全 provider 的接入参数。
type ProviderConfig struct {
	Type   string `json:"type"` // http
	Name   string `json:"name,omitempty"`
	URL    string `json:"url"`
	APIKey string `json:"apiKey,omitempty"`
}

// TenantConfig 是单个租户的内容安全审核配置。
type TenantConfig struct {
	Enabled       bool            `json:"enabled"`
	Mode          string          `json:"mode,omitempty"` // degraded（默认） | strict
	BlockSeverity string          `json:"blockSeverity,omitempty"` // 默认 critical
	TimeoutSeconds int            `json:"timeoutSeconds,omitempty"` // 默认 3
	Categories    []string       `json:"categories,omitempty"`
	Provider      ProviderConfig `json:"provider"`
}

// Strict 返回是否为 strict 模式（fail-closed 选装）；未知值按 degraded（默认）。
func (c TenantConfig) Strict() bool {
	return c.Mode == "strict"
}

// Timeout 返回 provider 调用超时。
func (c TenantConfig) Timeout() time.Duration {
	if c.TimeoutSeconds > 0 {
		return time.Duration(c.TimeoutSeconds) * time.Second
	}
	return 3 * time.Second
}

type snapshot struct {
	tenants map[string]TenantConfig
}

// ConfigLoader 后台轮询 moderation.json（admin-console 落盘），
// 提供原子快照查询（alertdispatch ConfigLoader 同款范式）。
// 文件不存在 = 空配置 = 现状等价（不外呼、不阻断）。
type ConfigLoader struct {
	path    string
	logger  *slog.Logger
	current atomic.Pointer[snapshot]
}

const defaultModerationFile = "moderation.json"

// NewConfigLoader 从 GATEWAY_ADMIN_MODERATION_FILE 读取路径；未设置时回退
// `${cwd}/.runtime/admin/moderation.json`。
func NewConfigLoader(logger *slog.Logger) *ConfigLoader {
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	path := os.Getenv("GATEWAY_ADMIN_MODERATION_FILE")
	if path == "" {
		cwd, _ := os.Getwd()
		path = filepath.Join(cwd, ".runtime", "admin", defaultModerationFile)
	}
	l := &ConfigLoader{path: path, logger: logger}
	l.current.Store(&snapshot{tenants: map[string]TenantConfig{}})
	return l
}

// Start 立即加载一次并周期刷新；文件缺失/解析失败保持旧快照。
func (l *ConfigLoader) Start(stop <-chan struct{}) {
	if err := l.Reload(); err != nil {
		l.logger.Info("moderation config not loaded yet", "path", l.path, "error", err)
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
					l.logger.Debug("reload moderation config failed", "error", err)
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
			l.current.Store(&snapshot{tenants: map[string]TenantConfig{}})
			return nil
		}
		return err
	}
	var parsed struct {
		Tenants map[string]TenantConfig `json:"tenants"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return err
	}
	if parsed.Tenants == nil {
		parsed.Tenants = map[string]TenantConfig{}
	}
	l.current.Store(&snapshot{tenants: parsed.Tenants})
	return nil
}

// Path 暴露配置路径（健康检查/排障用）。
func (l *ConfigLoader) Path() string { return l.path }

// Tenants 返回当前已配置的租户数（观测用）。
func (l *ConfigLoader) Tenants() int {
	s := l.current.Load()
	if s == nil {
		return 0
	}
	return len(s.tenants)
}

// Config 返回租户配置；未配置返回 false。
func (l *ConfigLoader) Config(tenantID string) (TenantConfig, bool) {
	s := l.current.Load()
	if s == nil {
		return TenantConfig{}, false
	}
	cfg, ok := s.tenants[tenantID]
	return cfg, ok
}
