package inbound_test

import (
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/inbound"
)

func TestParseClaudeMessagesBasic(t *testing.T) {
	body := strings.NewReader(`{
		"model": "claude-3-5-sonnet",
		"max_tokens": 1024,
		"system": "You are helpful",
		"messages": [{"role":"user","content":"Hello"}],
		"stream": true
	}`)
	req, err := inbound.ParseClaudeMessages(body)
	if err != nil {
		t.Fatal(err)
	}
	if req.Model != "claude-3-5-sonnet" || !req.Stream || req.System != "You are helpful" {
		t.Fatalf("unexpected %+v", req)
	}
	if len(req.Messages) != 1 || req.Messages[0].Content != "Hello" {
		t.Fatalf("messages %+v", req.Messages)
	}
}

func TestParseClaudeMessagesMissingModel(t *testing.T) {
	_, err := inbound.ParseClaudeMessages(strings.NewReader(`{"max_tokens":1,"messages":[{"role":"user","content":"x"}]}`))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseGeminiGenerate(t *testing.T) {
	body := strings.NewReader(`{
		"contents":[{"role":"user","parts":[{"text":"Hi"}]}],
		"generationConfig":{"maxOutputTokens":512}
	}`)
	req, err := inbound.ParseGeminiGenerate(body, "gemini-1.5-pro", true)
	if err != nil {
		t.Fatal(err)
	}
	if req.Model != "gemini-1.5-pro" || !req.Stream || req.MaxTokens != 512 {
		t.Fatalf("unexpected %+v", req)
	}
}

func TestParseResponsesStringInput(t *testing.T) {
	body := strings.NewReader(`{"model":"gpt-4.1","input":"hello","stream":false}`)
	req, err := inbound.ParseResponses(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(req.Messages) != 1 || req.Messages[0].Content != "hello" {
		t.Fatalf("unexpected %+v", req.Messages)
	}
}

func TestParseResponsesMessageInput(t *testing.T) {
	body := strings.NewReader(`{"model":"gpt-4.1","input":[{"role":"user","content":"hi"}]}`)
	req, err := inbound.ParseResponses(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(req.Messages) != 1 {
		t.Fatalf("unexpected %+v", req.Messages)
	}
}

func TestParseResponsesMissingInput(t *testing.T) {
	_, err := inbound.ParseResponses(strings.NewReader(`{"model":"gpt-4.1"}`))
	if err == nil {
		t.Fatal("expected error")
	}
}
