package mcphost

import (
	"context"
	"encoding/json"
	"fmt"
)

// EchoBackend exposes built-in diagnostic tools for MCP hosting smoke tests.
type EchoBackend struct{}

func (b *EchoBackend) Name() string { return BackendEcho }

func (b *EchoBackend) ListTools(_ context.Context, _ *ServerRecord) ([]Tool, error) {
	return []Tool{
		{
			Name:        "echo",
			Description: "Returns the provided message unchanged.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"message":{"type":"string","description":"Text to echo back"}},
				"required":["message"]
			}`),
		},
		{
			Name:        "ping",
			Description: "Returns pong for connectivity checks.",
			InputSchema: defaultInputSchema(),
		},
	}, nil
}

func (b *EchoBackend) CallTool(_ context.Context, _ *ServerRecord, name string, args map[string]any) (CallResult, error) {
	switch name {
	case "echo":
		msg, _ := args["message"].(string)
		if msg == "" {
			msg = fmt.Sprintf("%v", args["message"])
		}
		if msg == "" {
			return textResult("echo: message is required", true), nil
		}
		return textResult(msg, false), nil
	case "ping":
		return textResult("pong", false), nil
	default:
		return textResult("unknown tool: "+name, true), nil
	}
}
