package openai

import (
	"encoding/json"
	"testing"
)

func TestContentText_string(t *testing.T) {
	raw := NewStringContent("hello")
	if got := ContentText(raw); got != "hello" {
		t.Fatalf("got %q", got)
	}
}

func TestContentText_multimodal(t *testing.T) {
	raw := json.RawMessage(`[{"type":"text","text":"describe"},{"type":"image_url","image_url":{"url":"data:image/png;base64,abc"}}]`)
	if got := ContentText(raw); got != "describe" {
		t.Fatalf("got %q", got)
	}
}
