package channel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
	"github.com/agenticx/enterprise/gateway/internal/runtimeconfig"
)

const (
	defaultChannelsFile  = "../../.runtime/admin/channels.json"
	defaultReloadInterval = 5 * time.Second
)

// Registry 维护 Channel 快照，支持本地文件或 remote internal API。
type Registry struct {
	path    string
	remote  bool
	logger  *slog.Logger
	admin   *runtimeconfig.Loader
	current atomic.Pointer[[]Channel]
	status  *configstatus.Registry
	hasGood atomic.Bool
}

// SetConfigStatus 在 Start 之前注入生效状态登记点。
func (r *Registry) SetConfigStatus(status *configstatus.Registry) {
	if r == nil {
		return
	}
	r.status = status
}

func NewRegistry(logger *slog.Logger, admin *runtimeconfig.Loader) *Registry {
	url := strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_CHANNELS_URL"))
	path := strings.TrimSpace(os.Getenv("GATEWAY_ADMIN_CHANNELS_FILE"))
	remote := false
	if gatewayinternal.IsHTTPURL(url) {
		path = url
		remote = true
	} else if path == "" {
		cwd, _ := os.Getwd()
		path = filepath.Clean(filepath.Join(cwd, defaultChannelsFile))
	}
	r := &Registry{path: path, remote: remote, logger: logger, admin: admin}
	empty := []Channel{}
	r.current.Store(&empty)
	return r
}

func (r *Registry) Path() string { return r.path }

func (r *Registry) Enabled() bool {
	v := strings.TrimSpace(os.Getenv("GATEWAY_CHANNEL_REGISTRY"))
	return strings.EqualFold(v, "on") || strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}

func (r *Registry) Start(ctx context.Context) {
	if err := r.reload(); err != nil {
		r.logger.Warn("channels config not loaded", "path", r.path, "error", err)
	} else {
		r.logger.Info("channels config loaded", "path", r.path, "count", len(r.snapshot()))
	}
	go func() {
		ticker := time.NewTicker(defaultReloadInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := r.reload(); err != nil {
					r.logger.Debug("reload channels failed", "error", err)
				}
			}
		}
	}()
}

func (r *Registry) snapshot() []Channel {
	ptr := r.current.Load()
	if ptr == nil {
		return nil
	}
	return *ptr
}

func (r *Registry) ListByModel(tenantID, model string) []Channel {
	tenantID = strings.TrimSpace(tenantID)
	model = strings.TrimSpace(model)
	out := make([]Channel, 0)
	for _, ch := range r.snapshot() {
		if tenantID != "" && !strings.EqualFold(strings.TrimSpace(ch.TenantID), tenantID) {
			continue
		}
		if !ch.Active() {
			continue
		}
		if !ch.SupportsModel(model) {
			continue
		}
		out = append(out, ch)
	}
	return out
}

func (r *Registry) ByID(id string) (Channel, bool) {
	id = strings.TrimSpace(id)
	for _, ch := range r.snapshot() {
		if ch.ID == id {
			return ch, true
		}
	}
	return Channel{}, false
}

func (r *Registry) HasChannels() bool {
	return len(r.snapshot()) > 0
}

func (r *Registry) Snapshot() []Channel {
	return append([]Channel(nil), r.snapshot()...)
}

// SetSnapshot 用于测试与启动期 seed：直接替换内存快照，不触发 reload。
func (r *Registry) SetSnapshot(channels []Channel) {
	copyCh := append([]Channel(nil), channels...)
	r.current.Store(&copyCh)
}

func (r *Registry) reload() error {
	channels, raw, applied, err := r.loadRemoteOrFile()
	if err != nil {
		r.reportFailure(err)
		return err
	}
	synthesized := false
	if len(channels) == 0 && r.admin != nil {
		if synth := synthesizeFromProviders(r.admin); len(synth) > 0 {
			channels = synth
			if encoded, mErr := json.Marshal(channels); mErr == nil {
				raw = encoded
			}
			synthesized = true
		}
	}
	r.current.Store(&channels)
	// 只有真实来源（远端 2xx 或本地文件解析成功）且未再被合成覆盖时，才算最后可用快照。
	// 合成结果每次轮询重算；若把它记成 hasGood，远端持续 404 会冻住兼容渠道。
	if applied && !synthesized {
		r.hasGood.Store(true)
	}
	if applied || synthesized {
		r.reportSuccess(raw)
	}
	return nil
}

func (r *Registry) loadRemoteOrFile() (channels []Channel, raw []byte, applied bool, err error) {
	if r.remote {
		body, code, getErr := gatewayinternal.HTTPGet(r.path)
		if getErr != nil {
			return nil, nil, false, getErr
		}
		if code == http.StatusNotFound {
			if r.hasGood.Load() {
				return nil, nil, false, configstatus.ErrRemote404Keep
			}
			return []Channel{}, nil, false, nil
		}
		if code < 200 || code >= 300 {
			return nil, nil, false, fmt.Errorf("remote channels: http %d", code)
		}
		parsed, decErr := decodeChannels(body)
		if decErr != nil {
			return nil, nil, false, decErr
		}
		return parsed, body, true, nil
	}
	body, readErr := os.ReadFile(r.path)
	if readErr != nil {
		if errors.Is(readErr, os.ErrNotExist) {
			return []Channel{}, nil, false, nil
		}
		return nil, nil, false, readErr
	}
	parsed, decErr := decodeChannels(body)
	if decErr != nil {
		return nil, nil, false, decErr
	}
	return parsed, body, true, nil
}

func decodeChannels(body []byte) ([]Channel, error) {
	var parsed SnapshotFile
	if err := json.Unmarshal(body, &parsed); err != nil {
		// 兼容 internal API 直接返回 { channels: [...] } 或 bare array
		var wrap struct {
			Channels []Channel `json:"channels"`
		}
		if err2 := json.Unmarshal(body, &wrap); err2 == nil && wrap.Channels != nil {
			parsed.Channels = wrap.Channels
		} else {
			return nil, err
		}
	}
	if parsed.Channels == nil {
		parsed.Channels = []Channel{}
	}
	return parsed.Channels, nil
}

func (r *Registry) reportSuccess(raw []byte) {
	if r.status == nil {
		return
	}
	r.status.ReportSuccess(configstatus.DomainChannels, r.path, configstatus.HashBytes(raw), "")
}

func (r *Registry) reportFailure(err error) {
	if r.status == nil {
		return
	}
	r.status.ReportFailure(configstatus.DomainChannels, r.path, err)
}

// synthesizeFromProviders 把 admin providers 自动转成单 Channel 简写（NFR-1 兼容）。
func synthesizeFromProviders(admin *runtimeconfig.Loader) []Channel {
	if admin == nil {
		return nil
	}
	// 通过 ResolveByModel 无法枚举；读 providers 文件路径由 admin loader 维护。
	path := admin.Path()
	if path == "" || gatewayinternal.IsHTTPURL(path) {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var parsed struct {
		Providers []struct {
			ID          string `json:"id"`
			DisplayName string `json:"displayName"`
			BaseURL     string `json:"baseUrl"`
			APIKey      string `json:"apiKey"`
			Enabled     bool   `json:"enabled"`
			Route       string `json:"route"`
			Models      []struct {
				Name    string `json:"name"`
				Enabled bool   `json:"enabled"`
			} `json:"models"`
		} `json:"providers"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	out := make([]Channel, 0)
	for _, p := range parsed.Providers {
		if !p.Enabled {
			continue
		}
		models := make([]string, 0)
		for _, m := range p.Models {
			if m.Enabled && strings.TrimSpace(m.Name) != "" {
				models = append(models, m.Name)
			}
		}
		if len(models) == 0 {
			continue
		}
		out = append(out, Channel{
			ID:              "legacy-" + p.ID,
			TenantID:        strings.TrimSpace(os.Getenv("DEFAULT_TENANT_ID")),
			Name:            p.DisplayName,
			ProviderType:    "openai",
			BaseURL:         p.BaseURL,
			APIKey:          p.APIKey,
			Weight:          1,
			Priority:        0,
			Status:          StatusActive,
			SupportedModels: models,
			Route:           p.Route,
			ProviderLabel:   p.ID,
			Metadata: map[string]any{
				"legacyProvider": true,
				"provider":       p.ID,
			},
		})
	}
	return out
}
