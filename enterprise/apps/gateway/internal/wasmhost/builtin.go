package wasmhost

import (
	"fmt"
	"strings"
)

func newBuiltinPlugin(name string, m Manifest) (Plugin, error) {
	name = strings.TrimSpace(strings.ToLower(name))
	switch name {
	case "keyword-rewrite", "wasm-keyword-rewrite":
		return &KeywordRewritePlugin{basePlugin: basePlugin{manifest: m, name: m.Name}}, nil
	case "audit-tagger", "wasm-audit-tagger":
		return &AuditTaggerPlugin{basePlugin: basePlugin{manifest: m, name: m.Name}}, nil
	case "waf-basic", "wasm-waf-basic":
		return &WAFBasicPlugin{basePlugin: basePlugin{manifest: m, name: m.Name}}, nil
	case "bearer-extractor", "wasm-bearer-extractor":
		return &BearerExtractorPlugin{basePlugin: basePlugin{manifest: m, name: m.Name}}, nil
	default:
		return nil, fmt.Errorf("unknown builtin plugin %q", name)
	}
}

type basePlugin struct {
	manifest Manifest
	name     string
}

func (b *basePlugin) pluginName() string {
	if b.name != "" {
		return b.name
	}
	return b.manifest.Name
}

func (b *basePlugin) Close() error { return nil }

func noopHeaders(_ *HookContext) (Action, error) { return ActionContinue, nil }

func configString(m Manifest, key, fallback string) string {
	if m.Config == nil {
		return fallback
	}
	if v, ok := m.Config[key].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func configStringMap(m Manifest, key string) map[string]string {
	out := map[string]string{}
	if m.Config == nil {
		return out
	}
	raw, ok := m.Config[key].(map[string]any)
	if !ok {
		return out
	}
	for k, v := range raw {
		out[k] = fmt.Sprint(v)
	}
	return out
}

func configStringSlice(m Manifest, key string) []string {
	if m.Config == nil {
		return nil
	}
	switch v := m.Config[key].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			s := strings.TrimSpace(fmt.Sprint(item))
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return v
	default:
		return nil
	}
}

// KeywordRewritePlugin replaces configured substrings in response bodies.
type KeywordRewritePlugin struct {
	basePlugin
	replacements map[string]string
}

func (p *KeywordRewritePlugin) Name() string { return p.pluginName() }

func (p *KeywordRewritePlugin) Start(_ map[string]any) error {
	p.replacements = configStringMap(p.manifest, "replacements")
	if len(p.replacements) == 0 {
		p.replacements = map[string]string{"secret-keyword": "[REDACTED]"}
	}
	return nil
}

func (p *KeywordRewritePlugin) OnRequestHeaders(ctx *HookContext) (Action, error) {
	return ActionContinue, nil
}

func (p *KeywordRewritePlugin) OnRequestBody(ctx *HookContext, _ []byte, _ bool) (Action, error) {
	return ActionContinue, nil
}

func (p *KeywordRewritePlugin) OnResponseHeaders(ctx *HookContext) (Action, error) {
	return ActionContinue, nil
}

func (p *KeywordRewritePlugin) OnResponseBody(ctx *HookContext, body []byte, _ bool) (Action, []byte, error) {
	ctx.record(p.Name())
	text := string(body)
	for from, to := range p.replacements {
		text = strings.ReplaceAll(text, from, to)
	}
	return ActionContinue, []byte(text), nil
}

func (p *KeywordRewritePlugin) OnStreamChunk(ctx *HookContext, chunk []byte) (Action, []byte, error) {
	return p.OnResponseBody(ctx, chunk, false)
}

// AuditTaggerPlugin writes a tenant tag into hook properties for audit enrichment.
type AuditTaggerPlugin struct {
	basePlugin
	tag string
}

func (p *AuditTaggerPlugin) Name() string { return p.pluginName() }

func (p *AuditTaggerPlugin) Start(_ map[string]any) error {
	p.tag = configString(p.manifest, "audit_tag", "wasm-tagged")
	return nil
}

func (p *AuditTaggerPlugin) OnRequestHeaders(ctx *HookContext) (Action, error) {
	ctx.record(p.Name())
	if ctx.Properties == nil {
		ctx.Properties = map[string]string{}
	}
	ctx.Properties["audit_tag"] = p.tag
	return ActionContinue, nil
}

func (p *AuditTaggerPlugin) OnRequestBody(_ *HookContext, _ []byte, _ bool) (Action, error) {
	return ActionContinue, nil
}

func (p *AuditTaggerPlugin) OnResponseHeaders(_ *HookContext) (Action, error) { return ActionContinue, nil }
func (p *AuditTaggerPlugin) OnResponseBody(ctx *HookContext, body []byte, _ bool) (Action, []byte, error) {
	return ActionContinue, body, nil
}
func (p *AuditTaggerPlugin) OnStreamChunk(ctx *HookContext, chunk []byte) (Action, []byte, error) {
	return ActionContinue, chunk, nil
}

// WAFBasicPlugin applies lightweight prompt-injection and pattern checks on request bodies.
type WAFBasicPlugin struct {
	basePlugin
	keywords []string
	mode     string
}

func (p *WAFBasicPlugin) Name() string { return p.pluginName() }

func (p *WAFBasicPlugin) Start(_ map[string]any) error {
	p.keywords = configStringSlice(p.manifest, "prompt_injection_keywords")
	if len(p.keywords) == 0 {
		p.keywords = []string{"ignore previous instructions", "disregard prior", "system prompt override"}
	}
	p.mode = strings.ToLower(configString(p.manifest, "mode", "block"))
	return nil
}

func (p *WAFBasicPlugin) OnRequestHeaders(_ *HookContext) (Action, error) { return ActionContinue, nil }

func (p *WAFBasicPlugin) OnRequestBody(ctx *HookContext, body []byte, _ bool) (Action, error) {
	ctx.record(p.Name())
	text := strings.ToLower(string(body))
	for _, kw := range p.keywords {
		if strings.Contains(text, strings.ToLower(kw)) {
			if p.mode == "warn" {
				if ctx.Properties == nil {
					ctx.Properties = map[string]string{}
				}
				ctx.Properties["waf_warn"] = "prompt_injection"
				return ActionContinue, nil
			}
			ctx.StopStatus = 403
			ctx.StopBody = []byte(`{"code":"40301","message":"policy:waf:prompt_injection"}`)
			return ActionStop, nil
		}
	}
	return ActionContinue, nil
}

func (p *WAFBasicPlugin) OnResponseHeaders(_ *HookContext) (Action, error) { return ActionContinue, nil }
func (p *WAFBasicPlugin) OnResponseBody(ctx *HookContext, body []byte, _ bool) (Action, []byte, error) {
	return ActionContinue, body, nil
}
func (p *WAFBasicPlugin) OnStreamChunk(ctx *HookContext, chunk []byte) (Action, []byte, error) {
	return ActionContinue, chunk, nil
}

// BearerExtractorPlugin copies a configured header into hook properties.
type BearerExtractorPlugin struct {
	basePlugin
	header string
	prop   string
}

func (p *BearerExtractorPlugin) Name() string { return p.pluginName() }

func (p *BearerExtractorPlugin) Start(_ map[string]any) error {
	p.header = configString(p.manifest, "header", "X-Custom-Token")
	p.prop = configString(p.manifest, "property", "custom_token")
	return nil
}

func (p *BearerExtractorPlugin) OnRequestHeaders(ctx *HookContext) (Action, error) {
	ctx.record(p.Name())
	if ctx.Headers == nil {
		return ActionContinue, nil
	}
	if val := strings.TrimSpace(ctx.Headers[p.header]); val != "" {
		if ctx.Properties == nil {
			ctx.Properties = map[string]string{}
		}
		ctx.Properties[p.prop] = val
	}
	return ActionContinue, nil
}

func (p *BearerExtractorPlugin) OnRequestBody(_ *HookContext, _ []byte, _ bool) (Action, error) {
	return ActionContinue, nil
}
func (p *BearerExtractorPlugin) OnResponseHeaders(_ *HookContext) (Action, error) { return ActionContinue, nil }
func (p *BearerExtractorPlugin) OnResponseBody(ctx *HookContext, body []byte, _ bool) (Action, []byte, error) {
	return ActionContinue, body, nil
}
func (p *BearerExtractorPlugin) OnStreamChunk(ctx *HookContext, chunk []byte) (Action, []byte, error) {
	return ActionContinue, chunk, nil
}
