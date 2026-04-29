package routing

import (
	"net/http"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/runtimeconfig"
)

const (
	// 由 portal `/api/chat/completions` 反向代理在转发时填入，方便 gateway 命中具体 provider 而不必 model 全局唯一。
	HeaderProvider = "x-agenticx-provider"
)

type Decision struct {
	Route    string
	Provider string
	Endpoint string
	APIKey   string
	Model    string
}

type Decider struct {
	localRouteHeader string
	defaultRoute     string
	models           map[string]config.ModelRoute
	admin            *runtimeconfig.Loader
}

// NewDecider 旧版签名，保留给只跑 YAML 的测试场景。
func NewDecider(cfg config.Config) *Decider {
	return NewDeciderWithAdmin(cfg, nil)
}

// NewDeciderWithAdmin 把 admin Loader 织入路由决策；admin 命中时返回的 Decision
// 会带上 APIKey，使下游 provider 可以直接发起真实请求。
func NewDeciderWithAdmin(cfg config.Config, admin *runtimeconfig.Loader) *Decider {
	models := make(map[string]config.ModelRoute, len(cfg.Models))
	for _, model := range cfg.Models {
		models[strings.ToLower(model.Name)] = model
	}
	return &Decider{
		localRouteHeader: strings.ToLower(cfg.LocalRouteHeader),
		defaultRoute:     cfg.DefaultRoute,
		models:           models,
		admin:            admin,
	}
}

func (d *Decider) Decide(r *http.Request, modelName string) Decision {
	// admin 优先：admin-console 配置的 provider+model 命中时直接出 endpoint+key。
	if d.admin != nil {
		explicit := strings.TrimSpace(r.Header.Get(HeaderProvider))
		if resolved, ok := d.admin.ResolveByModel(modelName, explicit); ok {
			return Decision{
				Route:    resolved.Route,
				Provider: resolved.Provider,
				Endpoint: resolved.Endpoint,
				APIKey:   resolved.APIKey,
				Model:    resolved.Model,
			}
		}
	}

	// 请求头次之：支持本地/私有云/三方手动强制路由。
	headerDecision := strings.TrimSpace(strings.ToLower(r.Header.Get(d.localRouteHeader)))
	if headerDecision != "" {
		return Decision{
			Route: headerDecision,
			Model: modelName,
		}
	}

	cfgModel, ok := d.models[strings.ToLower(modelName)]
	if !ok {
		return Decision{
			Route: d.defaultRoute,
			Model: modelName,
		}
	}

	return Decision{
		Route:    cfgModel.Route,
		Provider: cfgModel.Provider,
		Endpoint: cfgModel.Endpoint,
		Model:    cfgModel.Name,
	}
}
