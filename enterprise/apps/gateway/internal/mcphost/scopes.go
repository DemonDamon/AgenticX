package mcphost

import (
	"strings"
)

const scopeWildcard = "mcp:*"

// ScopeRead returns the read scope for a hosted MCP server.
func ScopeRead(serverName string) string {
	return "mcp:server:" + strings.TrimSpace(serverName) + ":read"
}

// ScopeInvoke returns the invoke scope for a hosted MCP server.
func ScopeInvoke(serverName string) string {
	return "mcp:server:" + strings.TrimSpace(serverName) + ":invoke"
}

func hasScope(scopes []string, want string) bool {
	for _, s := range scopes {
		s = strings.TrimSpace(s)
		if s == scopeWildcard || s == want {
			return true
		}
	}
	return false
}

// CanListTools checks PAT/JWT scopes for tools/list access.
func CanListTools(scopes []string, serverName string, required []string) bool {
	if !requiredScopesMet(scopes, required) {
		return false
	}
	return hasScope(scopes, ScopeRead(serverName)) || hasScope(scopes, ScopeInvoke(serverName))
}

// CanInvokeTool checks scopes for tools/call access.
func CanInvokeTool(scopes []string, serverName string, required []string, toolMeta map[string]any) bool {
	if !requiredScopesMet(scopes, required) {
		return false
	}
	if !hasScope(scopes, ScopeInvoke(serverName)) {
		return false
	}
	if toolMeta != nil {
		if raw, ok := toolMeta["scopes"].([]any); ok {
			for _, item := range raw {
				if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
					if !hasScope(scopes, strings.TrimSpace(s)) {
						return false
					}
				}
			}
		}
	}
	return true
}

func requiredScopesMet(scopes []string, required []string) bool {
	if len(required) == 0 {
		return true
	}
	for _, req := range required {
		req = strings.TrimSpace(req)
		if req == "" {
			continue
		}
		if !hasScope(scopes, req) {
			return false
		}
	}
	return true
}
