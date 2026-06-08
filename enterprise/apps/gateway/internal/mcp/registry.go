package mcp

import (
	"strings"
	"sync"
)

// MCPServer is an upstream MCP server registered for reverse proxy.
type MCPServer struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	UpstreamURL   string `json:"upstreamUrl"`
	AuthHeader    string `json:"authHeader,omitempty"`
	Enabled       bool   `json:"enabled"`
	ToolRateLimit int    `json:"toolRateLimit,omitempty"`
	TenantID      string `json:"tenantId,omitempty"`
}

// Registry holds in-memory MCP server definitions for the gateway proxy.
type Registry struct {
	mu      sync.RWMutex
	servers map[string]MCPServer
}

func NewRegistry() *Registry {
	return &Registry{servers: map[string]MCPServer{}}
}

func (r *Registry) Get(id string) (MCPServer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.servers[strings.TrimSpace(id)]
	return s, ok
}

func (r *Registry) List() []MCPServer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]MCPServer, 0, len(r.servers))
	for _, s := range r.servers {
		out = append(out, s)
	}
	return out
}

func (r *Registry) Replace(servers []MCPServer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	next := make(map[string]MCPServer, len(servers))
	for _, s := range servers {
		id := strings.TrimSpace(s.ID)
		if id == "" {
			continue
		}
		s.ID = id
		next[id] = s
	}
	r.servers = next
}
