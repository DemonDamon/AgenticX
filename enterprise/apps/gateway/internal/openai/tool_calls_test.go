package openai

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestChatMessageRoundTripKeepsToolCalls(t *testing.T) {
	raw := []byte(`{"id":"x","object":"chat.completion","created":1,"model":"m","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"diag-echo__echo","arguments":"{\"message\":\"hello-acp05\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`)
	var resp ChatCompletionResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out, []byte(`"tool_calls"`)) || !bytes.Contains(out, []byte(`diag-echo__echo`)) {
		t.Fatalf("tool_calls dropped: %s", out)
	}

	req := ChatCompletionRequest{
		Model: "m",
		Messages: []ChatMessage{{
			Role:      "assistant",
			Content:   NewStringContent(""),
			ToolCalls: json.RawMessage(`[{"id":"call_1","type":"function","function":{"name":"echo","arguments":"{}"}}]`),
		}},
		Tools: []Tool{{Type: "function", Function: &ToolFunction{Name: "echo"}}},
	}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte(`"tool_calls"`)) || !bytes.Contains(body, []byte(`"tools"`)) {
		t.Fatalf("request dropped tool fields: %s", body)
	}
}
