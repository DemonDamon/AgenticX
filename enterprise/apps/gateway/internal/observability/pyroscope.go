package observability

import (
	"os"
	"strings"
)

// PyroscopeConfig exposes optional continuous profiling settings for admin UI.
type PyroscopeConfig struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url,omitempty"`
	AppName string `json:"app_name,omitempty"`
}

func PyroscopeConfigFromEnv() PyroscopeConfig {
	url := strings.TrimSpace(os.Getenv("PYROSCOPE_URL"))
	if url == "" {
		url = strings.TrimSpace(os.Getenv("PYROSCOPE_SERVER_ADDRESS"))
	}
	appName := strings.TrimSpace(os.Getenv("PYROSCOPE_APP_NAME"))
	if appName == "" {
		appName = "agenticx-gateway"
	}
	enabled := envOn("GATEWAY_PYROSCOPE", url != "")
	return PyroscopeConfig{
		Enabled: enabled && url != "",
		URL:     url,
		AppName: appName,
	}
}

func InitPyroscopeFromEnv() {
	cfg := PyroscopeConfigFromEnv()
	if !cfg.Enabled {
		return
	}
	// Continuous profiling is optional; admin UI links to the configured Pyroscope instance.
	// Native pyroscope-go integration can be enabled later without changing env contract.
}
