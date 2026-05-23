package mcphost

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// OpenAPIBackend proxies MCP tool calls to HTTP endpoints described by OpenAPI 3.x.
type OpenAPIBackend struct {
	client *http.Client
}

func NewOpenAPIBackend() *OpenAPIBackend {
	return &OpenAPIBackend{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (b *OpenAPIBackend) Name() string { return BackendOpenAPI }

func (b *OpenAPIBackend) ListTools(ctx context.Context, rec *ServerRecord) ([]Tool, error) {
	if rec == nil {
		return nil, fmt.Errorf("openapi backend: nil server")
	}
	if len(rec.Tools) > 0 {
		out := make([]Tool, 0, len(rec.Tools))
		for _, t := range rec.Tools {
			if t.Enabled {
				out = append(out, t)
			}
		}
		return out, nil
	}
	specRaw, err := openAPIBlobFromConfig(rec.BackendConfig)
	if err != nil {
		return nil, err
	}
	spec, err := ParseOpenAPISpec(specRaw)
	if err != nil {
		return nil, err
	}
	allowed := allowedOperationsFromConfig(rec.BackendConfig)
	return spec.Tools(allowed), nil
}

func (b *OpenAPIBackend) CallTool(ctx context.Context, rec *ServerRecord, name string, args map[string]any) (CallResult, error) {
	specRaw, err := openAPIBlobFromConfig(rec.BackendConfig)
	if err != nil {
		return textResult(err.Error(), true), nil
	}
	spec, err := ParseOpenAPISpec(specRaw)
	if err != nil {
		return textResult(err.Error(), true), nil
	}
	op, ok := spec.OperationByID(name)
	if !ok {
		return textResult("unknown operation: "+name, true), nil
	}
	baseURL := strings.TrimSpace(spec.BaseURL)
	if v, ok := rec.BackendConfig["base_url"].(string); ok && strings.TrimSpace(v) != "" {
		baseURL = strings.TrimSpace(v)
	}
	if baseURL == "" {
		return textResult("openapi backend: base_url missing", true), nil
	}
	target, body, err := op.BuildRequest(baseURL, args)
	if err != nil {
		return textResult(err.Error(), true), nil
	}
	req, err := http.NewRequestWithContext(ctx, op.Method, target, body)
	if err != nil {
		return textResult(err.Error(), true), nil
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := b.client.Do(req)
	if err != nil {
		return textResult("upstream request failed: "+err.Error(), true), nil
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return textResult(fmt.Sprintf("upstream HTTP %d: %s", resp.StatusCode, string(raw)), true), nil
	}
	if len(raw) == 0 {
		return textResult("upstream returned empty body", false), nil
	}
	if json.Valid(raw) {
		return textResult(string(raw), false), nil
	}
	return textResult(string(raw), false), nil
}

func openAPIBlobFromConfig(cfg map[string]any) ([]byte, error) {
	if cfg == nil {
		return nil, fmt.Errorf("openapi backend: empty backend_config")
	}
	if raw, ok := cfg["openapi_json"].(string); ok && strings.TrimSpace(raw) != "" {
		return []byte(raw), nil
	}
	if blob, ok := cfg["openapi_blob"].(string); ok && strings.TrimSpace(blob) != "" {
		return decodeOpenAPIBlob(blob)
	}
	return nil, fmt.Errorf("openapi backend: openapi spec missing in backend_config")
}

func allowedOperationsFromConfig(cfg map[string]any) map[string]struct{} {
	out := map[string]struct{}{}
	if cfg == nil {
		return out
	}
	switch v := cfg["allowed_operation_ids"].(type) {
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out[strings.TrimSpace(s)] = struct{}{}
			}
		}
	case []string:
		for _, s := range v {
			if strings.TrimSpace(s) != "" {
				out[strings.TrimSpace(s)] = struct{}{}
			}
		}
	}
	return out
}

// BuildRequest constructs the upstream HTTP request for an OpenAPI operation.
func (op OpenAPIOperation) BuildRequest(baseURL string, args map[string]any) (string, io.Reader, error) {
	if args == nil {
		args = map[string]any{}
	}
	path := op.Path
	query := url.Values{}
	var bodyPayload map[string]any

	for _, p := range op.Parameters {
		val, ok := args[p.Name]
		if !ok {
			continue
		}
		switch strings.ToLower(p.In) {
		case "path":
			path = strings.ReplaceAll(path, "{"+p.Name+"}", url.PathEscape(fmt.Sprint(val)))
		case "query":
			query.Set(p.Name, fmt.Sprint(val))
		case "body", "requestbody":
			if m, ok := val.(map[string]any); ok {
				bodyPayload = m
			}
		}
	}
	if bodyPayload == nil {
		if rb, ok := args["body"].(map[string]any); ok {
			bodyPayload = rb
		}
	}
	u, err := url.Parse(strings.TrimRight(baseURL, "/") + path)
	if err != nil {
		return "", nil, err
	}
	u.RawQuery = query.Encode()
	var body io.Reader
	if bodyPayload != nil && op.Method != http.MethodGet && op.Method != http.MethodHead {
		raw, err := json.Marshal(bodyPayload)
		if err != nil {
			return "", nil, err
		}
		body = bytes.NewReader(raw)
	}
	return u.String(), body, nil
}
