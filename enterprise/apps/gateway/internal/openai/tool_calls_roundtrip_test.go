package openai

import (
	"encoding/json"
	"testing"
)

func TestChatMessageToolCallsRoundTrip(t *testing.T) {
	raw := []byte(`{
		"role":"assistant",
		"content":null,
		"tool_calls":[{
			"id":"call_abc",
			"type":"function",
			"function":{"name":"list_dir","arguments":"{\"path\":\".\"}"}
		}]
	}`)
	var msg ChatMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(msg.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool_call, got %d", len(msg.ToolCalls))
	}
	if msg.ToolCalls[0].ID != "call_abc" {
		t.Fatalf("id=%q", msg.ToolCalls[0].ID)
	}
	if msg.ToolCalls[0].Function == nil || msg.ToolCalls[0].Function.Name != "list_dir" {
		t.Fatalf("function=%+v", msg.ToolCalls[0].Function)
	}
	out, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var again ChatMessage
	if err := json.Unmarshal(out, &again); err != nil {
		t.Fatalf("re-unmarshal: %v", err)
	}
	if len(again.ToolCalls) != 1 || again.ToolCalls[0].Function.Name != "list_dir" {
		t.Fatalf("lost tool_calls after round-trip: %+v", again.ToolCalls)
	}
}

func TestStreamDeltaToolCallsRoundTrip(t *testing.T) {
	idx := 0
	chunk := StreamChunk{
		ID:      "chatcmpl-1",
		Object:  "chat.completion.chunk",
		Choices: []StreamChoice{{
			Index: 0,
			Delta: StreamDelta{
				ToolCalls: []ToolCall{{
					Index: &idx,
					ID:    "call_abc",
					Type:  "function",
					Function: &ToolCallFunction{
						Name:      "list_dir",
						Arguments: "{\"path\"",
					},
				}},
			},
		}},
	}
	payload, err := json.Marshal(chunk)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var parsed StreamChunk
	if err := json.Unmarshal(payload, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	tc := parsed.Choices[0].Delta.ToolCalls
	if len(tc) != 1 || tc[0].Function == nil || tc[0].Function.Name != "list_dir" {
		t.Fatalf("stream tool_calls lost: %s", string(payload))
	}
}

func TestToolRoleHistoryRoundTrip(t *testing.T) {
	raw := []byte(`{
		"model":"m",
		"messages":[
			{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"f","arguments":"{}"}}]},
			{"role":"tool","tool_call_id":"call_1","content":"ok"}
		],
		"tools":[{"type":"function","function":{"name":"f","parameters":{}}}],
		"tool_choice":"auto"
	}`)
	var req ChatCompletionRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(req.Tools) != 1 || req.ToolChoice == nil {
		t.Fatalf("tools/tool_choice lost")
	}
	if len(req.Messages) != 2 {
		t.Fatalf("messages=%d", len(req.Messages))
	}
	if len(req.Messages[0].ToolCalls) != 1 {
		t.Fatalf("assistant tool_calls lost")
	}
	if req.Messages[1].Role != "tool" || req.Messages[1].ToolCallID != "call_1" {
		t.Fatalf("tool message lost: %+v", req.Messages[1])
	}
	out, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var again ChatCompletionRequest
	if err := json.Unmarshal(out, &again); err != nil {
		t.Fatalf("re-unmarshal: %v", err)
	}
	if len(again.Messages[0].ToolCalls) != 1 || again.Messages[1].ToolCallID != "call_1" {
		t.Fatalf("history round-trip failed: %s", string(out))
	}
}

func TestReasoningSplitRoundTrip(t *testing.T) {
	raw := []byte(`{"model":"p/m","messages":[{"role":"user","content":"hi"}],"reasoning_split":true}`)
	var req ChatCompletionRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if req.ReasoningSplit == nil || !*req.ReasoningSplit {
		t.Fatalf("reasoning_split not preserved on unmarshal")
	}
	out, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var again ChatCompletionRequest
	if err := json.Unmarshal(out, &again); err != nil {
		t.Fatalf("re-unmarshal: %v", err)
	}
	if again.ReasoningSplit == nil || !*again.ReasoningSplit {
		t.Fatalf("reasoning_split lost after round-trip: %s", string(out))
	}
}
