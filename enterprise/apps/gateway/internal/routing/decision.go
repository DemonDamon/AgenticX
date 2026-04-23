package routing

import (
	"net/http"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/config"
)

type Decision struct {
	Route    string
	Provider string
	Endpoint string
	Model    string
}

type Decider struct {
	localRouteHeader string
	defaultRoute     string
	models           map[string]config.ModelRoute
}

func NewDecider(cfg config.Config) *Decider {
	models := make(map[string]config.ModelRoute, len(cfg.Models))
	for _, model := range cfg.Models {
		models[strings.ToLower(model.Name)] = model
	}
	return &Decider{
		localRouteHeader: strings.ToLower(cfg.LocalRouteHeader),
		defaultRoute:     cfg.DefaultRoute,
		models:           models,
	}
}

func (d *Decider) Decide(r *http.Request, modelName string) Decision {
	// 请求头优先用于强制路由，支持 local/private-cloud/third-party。
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
