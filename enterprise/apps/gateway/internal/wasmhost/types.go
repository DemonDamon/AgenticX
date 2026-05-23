package wasmhost

import (
	"os"
	"strings"
)

// Action is the hook decision returned by a plugin.
type Action int32

const (
	ActionContinue Action = 0
	ActionStop     Action = 1
)

// HookContext carries per-request mutable state across plugin hooks.
type HookContext struct {
	TenantID   string
	UserID     string
	Route      string
	Method     string
	ClientIP   string
	Headers    map[string]string
	Properties map[string]string
	Invoked    []string
	StopBody   []byte
	StopStatus int
}

func (c *HookContext) record(name string) {
	if c == nil || name == "" {
		return
	}
	for _, n := range c.Invoked {
		if n == name {
			return
		}
	}
	c.Invoked = append(c.Invoked, name)
}

// Plugin implements gateway wasm/native hook points.
type Plugin interface {
	Name() string
	Start(config map[string]any) error
	OnRequestHeaders(ctx *HookContext) (Action, error)
	OnRequestBody(ctx *HookContext, body []byte, endOfStream bool) (Action, error)
	OnResponseHeaders(ctx *HookContext) (Action, error)
	OnResponseBody(ctx *HookContext, body []byte, endOfStream bool) (Action, []byte, error)
	OnStreamChunk(ctx *HookContext, chunk []byte) (Action, []byte, error)
	Close() error
}

func Enabled() bool {
	v := strings.TrimSpace(os.Getenv("GATEWAY_WASM_PLUGINS"))
	if v == "" {
		return true
	}
	return strings.EqualFold(v, "on") || strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}

func Disabled() bool { return !Enabled() }
