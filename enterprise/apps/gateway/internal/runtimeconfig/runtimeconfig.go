// Package runtimeconfig 读取 admin-console 落盘的 providers.json，
// 提供 model -> (provider/endpoint/api_key) 的实时查表。
//
// 设计要点：
//   - 文件不存在或解析失败时返回空快照，调用方应回退原有 YAML/env 路径。
//   - 后台 goroutine 每 ProvidersReloadInterval 重读一次，不会阻塞业务请求；
//     这样 admin 在控制台改完 Key 几秒内就能在网关上生效，无需重启。
package runtimeconfig

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

const (
	defaultProvidersFile  = "../../.runtime/admin/providers.json"
	defaultReloadInterval = 5 * time.Second
)

// ProviderModel 与 admin-console 字段对齐。
type ProviderModel struct {
	Name         string   `json:"name"`
	Label        string   `json:"label"`
	Capabilities []string `json:"capabilities,omitempty"`
	Enabled      bool     `json:"enabled"`
}

type ProviderRecord struct {
	ID          string          `json:"id"`
	DisplayName string          `json:"displayName"`
	BaseURL     string          `json:"baseUrl"`
	APIKey      string          `json:"apiKey"`
	Enabled     bool             `json:"enabled"`
	IsDefault   bool             `json:"isDefault"`
	Route       string           `json:"route"`
	EnvKey      string           `json:"envKey,omitempty"`
	Models      []ProviderModel `json:"models"`
}

// ResolvedRoute 是 gateway 真正需要的最少信息。
type ResolvedRoute struct {
	Provider string
	Route    string
	Endpoint string
	APIKey   string
	Model    string
}

type snapshot struct {
	providers []ProviderRecord
}

// Loader 负责后台异步刷新 providers.json，并对外提供原子快照查询。
type Loader struct {
	path     string
	logger   *slog.Logger
	current  atomic.Pointer[snapshot]
}

// New 创建一个 Loader 但不启动；调用方需 Start。
//
// 默认从 GATEWAY_ADMIN_PROVIDERS_FILE 读取；若未设置则回退到
// `${cwd}/<defaultProvidersFile>`，与 admin-console 对齐。
func New(logger *slog.Logger) *Loader {
	path := strings.TrimSpace(os.Getenv("GATEWAY_ADMIN_PROVIDERS_FILE"))
	if path == "" {
		cwd, _ := os.Getwd()
		path = filepath.Clean(filepath.Join(cwd, defaultProvidersFile))
	}
	l := &Loader{path: path, logger: logger}
	empty := &snapshot{}
	l.current.Store(empty)
	return l
}

// Path 暴露当前 watch 的路径，方便 admin/healthz 类信息回显。
func (l *Loader) Path() string { return l.path }

// Start 立即读取一次，然后开 goroutine 周期刷新；ctx 取消时 goroutine 退出。
func (l *Loader) Start(ctx context.Context) {
	if err := l.reload(); err != nil {
		l.logger.Warn("admin providers config not loaded", "path", l.path, "error", err)
	} else {
		l.logger.Info("admin providers config loaded", "path", l.path, "providers", len(l.snapshot().providers))
	}
	go func() {
		ticker := time.NewTicker(defaultReloadInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := l.reload(); err != nil {
					l.logger.Debug("reload admin providers config failed", "error", err)
				}
			}
		}
	}()
}

func (l *Loader) snapshot() *snapshot {
	return l.current.Load()
}

func (l *Loader) reload() error {
	bytes, err := os.ReadFile(l.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// 没有文件视为「未配置」，保留空快照
			l.current.Store(&snapshot{})
			return nil
		}
		return err
	}
	var parsed struct {
		Providers []ProviderRecord `json:"providers"`
	}
	if err := json.Unmarshal(bytes, &parsed); err != nil {
		return err
	}
	if parsed.Providers == nil {
		parsed.Providers = []ProviderRecord{}
	}
	l.current.Store(&snapshot{providers: parsed.Providers})
	return nil
}

// ResolveByModel 根据用户请求里的模型名查 admin 配置：
//   - modelName 形如 "gpt-4o-mini"（来自请求 body.model）；
//   - explicitProvider 来自上游代理的请求头 x-agenticx-provider，可空。
//
// 命中条件（按优先级）：
//  1. provider id 与 model.name 同时匹配（大小写敏感对齐 admin 写入值）；
//  2. 仅模型名命中且只有一个 provider 提供该模型；
//  3. 模型名命中多家 provider 时，优先 isDefault & enabled。
//
// 未命中返回 false，由调用方回退到 YAML 配置。
func (l *Loader) ResolveByModel(modelName, explicitProvider string) (ResolvedRoute, bool) {
	snap := l.snapshot()
	if snap == nil || len(snap.providers) == 0 {
		return ResolvedRoute{}, false
	}
	model := strings.TrimSpace(modelName)
	if model == "" {
		return ResolvedRoute{}, false
	}
	provider := strings.TrimSpace(explicitProvider)

	type candidate struct {
		p ProviderRecord
		m ProviderModel
	}
	var matches []candidate
	for _, p := range snap.providers {
		if !p.Enabled {
			continue
		}
		if provider != "" && !strings.EqualFold(p.ID, provider) {
			continue
		}
		for _, m := range p.Models {
			if !m.Enabled {
				continue
			}
			if m.Name == model {
				matches = append(matches, candidate{p: p, m: m})
			}
		}
	}
	if len(matches) == 0 {
		return ResolvedRoute{}, false
	}

	// pick best
	best := matches[0]
	for _, c := range matches[1:] {
		if c.p.IsDefault && !best.p.IsDefault {
			best = c
		}
	}
	return ResolvedRoute{
		Provider: best.p.ID,
		Route:    best.p.Route,
		Endpoint: best.p.BaseURL,
		APIKey:   best.p.APIKey,
		Model:    best.m.Name,
	}, true
}
