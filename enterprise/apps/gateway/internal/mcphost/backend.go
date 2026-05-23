package mcphost

import (
	"encoding/json"
	"fmt"
)

const (
	BackendEcho    = "echo"
	BackendOpenAPI = "openapi"
	BackendCustom  = "custom-go"
)

func NewBackend(backendType string) (Backend, error) {
	switch backendType {
	case BackendEcho, "":
		return &EchoBackend{}, nil
	case BackendOpenAPI:
		return NewOpenAPIBackend(), nil
	default:
		return nil, fmt.Errorf("mcphost: unsupported backend_type %q", backendType)
	}
}

func defaultInputSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","properties":{}}`)
}

func textResult(text string, isError bool) CallResult {
	return CallResult{
		Content: []ContentBlock{{Type: "text", Text: text}},
		IsError: isError,
	}
}

func jsonResult(v any) (CallResult, error) {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return CallResult{}, err
	}
	return textResult(string(raw), false), nil
}
