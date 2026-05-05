package server

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// 历史轮次内残留 PII 不应在 request 阶段被再次扫描，
// 否则会导致整个会话被永久拦截，无法继续追问无害问题。
func TestLatestUserMessageContent_OnlyReturnsLastUserContent(t *testing.T) {
	messages := []openai.ChatMessage{
		{Role: "system", Content: "你是助手"},
		{Role: "user", Content: "我的银行卡号是 6222021234567890123"},
		{Role: "assistant", Content: "请求触发合规拦截"},
		{Role: "user", Content: "那今天天气如何"},
	}

	got := latestUserMessageContent(messages)
	want := "那今天天气如何"
	if got != want {
		t.Fatalf("expected only the latest user message to be evaluated, got=%q want=%q", got, want)
	}
}

func TestLatestUserMessageContent_FallbacksWhenNoUserMessage(t *testing.T) {
	messages := []openai.ChatMessage{
		{Role: "system", Content: "你是助手"},
		{Role: "assistant", Content: "请输入问题"},
	}

	got := latestUserMessageContent(messages)
	if got == "" {
		t.Fatalf("expected fallback to joined messages when no user message exists, got empty")
	}
}

// redact 命中时仅替换最后一条 user 消息的 content，
// 保留多轮对话上下文，不应把整段历史压成单条 user message。
func TestReplaceLastUserMessageContent_PreservesMultiTurn(t *testing.T) {
	messages := []openai.ChatMessage{
		{Role: "system", Content: "你是助手"},
		{Role: "user", Content: "我的卡号是 6222021234567890123"},
		{Role: "assistant", Content: "好的"},
		{Role: "user", Content: "再帮我看下卡号 6222021234567890123 的归属地"},
	}

	next := replaceLastUserMessageContent(messages, "再帮我看下卡号 [REDACTED] 的归属地")

	if len(next) != len(messages) {
		t.Fatalf("expected message count preserved, got=%d want=%d", len(next), len(messages))
	}
	if next[1].Content != messages[1].Content {
		t.Fatalf("expected earlier user message untouched, got=%q want=%q", next[1].Content, messages[1].Content)
	}
	if next[3].Role != "user" {
		t.Fatalf("expected last role to remain user, got=%q", next[3].Role)
	}
	if next[3].Content != "再帮我看下卡号 [REDACTED] 的归属地" {
		t.Fatalf("expected last user content replaced, got=%q", next[3].Content)
	}
}

func TestReplaceLastUserMessageContent_NoUserIsNoop(t *testing.T) {
	messages := []openai.ChatMessage{
		{Role: "system", Content: "system only"},
	}

	next := replaceLastUserMessageContent(messages, "ignored")
	if len(next) != 1 || next[0].Content != "system only" {
		t.Fatalf("expected messages untouched when no user present, got=%+v", next)
	}
}
