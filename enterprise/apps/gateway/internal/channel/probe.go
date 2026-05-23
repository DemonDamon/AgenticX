package channel

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ProbeResult captures channel self-check output.
type ProbeResult struct {
	ChannelID       string            `json:"channel_id"`
	SupportedModels []string          `json:"supported_models"`
	KeyHealth       []KeyHealthResult `json:"key_health"`
	LastProbeError  string            `json:"last_probe_error,omitempty"`
	ProbedAt        string            `json:"probed_at"`
}

type KeyHealthResult struct {
	KeyRef      string `json:"key_ref"`
	Status      string `json:"status"`
	LastError   string `json:"last_error,omitempty"`
	LastProbeAt string `json:"last_probe_at"`
}

// Prober performs upstream model-list and key health checks.
type Prober struct {
	client *http.Client
}

func NewProber() *Prober {
	return &Prober{client: &http.Client{Timeout: 20 * time.Second}}
}

func (p *Prober) Probe(ctx context.Context, ch Channel, keys map[string]string) ProbeResult {
	result := ProbeResult{
		ChannelID: ch.ID,
		ProbedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	base := strings.TrimRight(strings.TrimSpace(ch.BaseURL), "/")
	if base == "" {
		result.LastProbeError = "channel base_url missing"
		return result
	}
	refs := ch.KeyRefs()
	if len(refs) == 0 && strings.TrimSpace(ch.APIKey) != "" {
		refs = []string{"default"}
		keys = map[string]string{"default": ch.APIKey}
	}
	if len(refs) == 0 {
		result.LastProbeError = "no api keys configured"
		return result
	}
	firstKey := keys[refs[0]]
	models, err := p.listModels(ctx, base, firstKey, ch.ProviderType)
	if err != nil {
		result.LastProbeError = err.Error()
	} else {
		result.SupportedModels = models
	}
	for _, ref := range refs {
		key := strings.TrimSpace(keys[ref])
		if key == "" {
			result.KeyHealth = append(result.KeyHealth, KeyHealthResult{
				KeyRef: ref, Status: "missing", LastError: "key not found", LastProbeAt: result.ProbedAt,
			})
			continue
		}
		status, probeErr := p.probeKey(ctx, base, key, ch.ProviderType)
		item := KeyHealthResult{KeyRef: ref, LastProbeAt: result.ProbedAt}
		if probeErr != nil {
			item.Status = "unhealthy"
			item.LastError = probeErr.Error()
		} else if status >= 400 {
			item.Status = "unhealthy"
			item.LastError = fmt.Sprintf("HTTP %d", status)
		} else {
			item.Status = "healthy"
		}
		result.KeyHealth = append(result.KeyHealth, item)
	}
	return result
}

func (p *Prober) listModels(ctx context.Context, baseURL, apiKey, providerType string) ([]string, error) {
	url := modelsURL(baseURL, providerType)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("list models HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var openaiModels struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &openaiModels); err == nil && len(openaiModels.Data) > 0 {
		out := make([]string, 0, len(openaiModels.Data))
		for _, item := range openaiModels.Data {
			if strings.TrimSpace(item.ID) != "" {
				out = append(out, strings.TrimSpace(item.ID))
			}
		}
		return out, nil
	}
	var geminiModels struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &geminiModels); err == nil {
		out := make([]string, 0, len(geminiModels.Models))
		for _, item := range geminiModels.Models {
			name := strings.TrimPrefix(strings.TrimSpace(item.Name), "models/")
			if name != "" {
				out = append(out, name)
			}
		}
		if len(out) > 0 {
			return out, nil
		}
	}
	return nil, fmt.Errorf("unable to parse model list")
}

func modelsURL(baseURL, providerType string) string {
	switch strings.ToLower(strings.TrimSpace(providerType)) {
	case "gemini", "google":
		if strings.Contains(baseURL, "/v1beta") {
			return strings.TrimRight(baseURL, "/") + "/models"
		}
		return strings.TrimRight(baseURL, "/") + "/v1beta/models"
	default:
		if strings.HasSuffix(baseURL, "/v1") {
			return baseURL + "/models"
		}
		return strings.TrimRight(baseURL, "/") + "/v1/models"
	}
}

func (p *Prober) probeKey(ctx context.Context, baseURL, apiKey, providerType string) (int, error) {
	url := modelsURL(baseURL, providerType)
	if strings.Contains(url, "?") {
		url += "&limit=1"
	} else {
		url += "?limit=1"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := p.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	return resp.StatusCode, nil
}
