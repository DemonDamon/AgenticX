package openai

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestCompatibleRequestConsolidatesSystemMessages(t *testing.T) {
	user := ChatMessage{Role: "user", Content: json.RawMessage(`[{"type":"text","text":"请只回复：收到"},{"type":"image_url","image_url":{"url":"data:image/png;base64,test"}}]`)}
	assistant := ChatMessage{Role: "assistant", Content: NewStringContent("已收到")}
	for _, messages := range [][]ChatMessage{
		{{Role: "system", Content: NewStringContent("反馈示例")}, {Role: "system", Content: NewStringContent("平台能力")}, user, assistant},
		{{Role: "system", Content: NewStringContent("反馈示例")}, user, {Role: "system", Content: json.RawMessage(`[{"type":"text","text":"平台能力"}]`)}, assistant},
	} {
		original, _ := json.Marshal(messages)
		got := CompatibleRequest(ChatCompletionRequest{Model: "qwen3.8", Messages: messages})
		if len(got.Messages) != 3 || got.Messages[0].Role != "system" || ContentText(got.Messages[0].Content) != "反馈示例\n\n平台能力" {
			t.Fatalf("invalid system layout: %+v", got.Messages)
		}
		if !reflect.DeepEqual(got.Messages[1:], []ChatMessage{user, assistant}) {
			t.Fatal("conversation content or images changed")
		}
		after, _ := json.Marshal(messages)
		if string(original) != string(after) {
			t.Fatal("caller messages mutated")
		}
		if twice := CompatibleRequest(got); !reflect.DeepEqual(twice.Messages, got.Messages) {
			t.Fatal("system normalization is not idempotent")
		}
	}
}

func TestCompatibleRequestWithoutSystemPreservesConversation(t *testing.T) {
	messages := []ChatMessage{{Role: "user", Content: NewStringContent("你好")}}
	if got := CompatibleRequest(ChatCompletionRequest{Messages: messages}); !reflect.DeepEqual(got.Messages, messages) {
		t.Fatal("conversation without system messages changed")
	}
}

func TestCompatibleRequestDropsSamplingForStrictKimiTemplates(t *testing.T) {
	got := CompatibleRequest(ChatCompletionRequest{Model: "vendor/kimi-k2.6", Temperature: 0.2, TopP: 0.8})
	if got.Temperature != 0 || got.TopP != 0 {
		t.Fatalf("sampling kept: temp=%v top_p=%v", got.Temperature, got.TopP)
	}
}
