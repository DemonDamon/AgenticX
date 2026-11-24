package relay

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

type progressAdaptor struct {
	adaptor.Adaptor
	chunk          *openai.StreamChunk
	aCalls, bCalls int
}

func (a *progressAdaptor) Stream(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel, push adaptor.StreamPush) error {
	if ch.ID == "a" {
		a.aCalls++
		if a.chunk != nil {
			if err := push(*a.chunk); err != nil {
				return err
			}
		}
		return &adaptor.UpstreamError{StatusCode: 503, Body: "synthetic failure"}
	}
	a.bCalls++
	return nil
}

func progressExecutor(t *testing.T, a *progressAdaptor, keys bool) *Executor {
	t.Helper()
	first := channel.Channel{ID: "a", TenantID: "t", ProviderType: "openai", Status: channel.StatusActive, APIKey: "synthetic", SupportedModels: []string{"m"}}
	if keys {
		t.Setenv("G1_TEST_KEY_ONE", "one")
		t.Setenv("G1_TEST_KEY_TWO", "two")
		first.APIKey = ""
		first.Metadata = map[string]any{"keyRefs": []string{"G1_TEST_KEY_ONE", "G1_TEST_KEY_TWO"}}
	}
	second := first
	second.ID = "b"
	second.APIKey = "synthetic"
	second.Metadata = nil
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot([]channel.Channel{first, second})
	aff := channel.NewAffinityStore(time.Minute)
	aff.Set("s", "m", "a")
	return NewExecutor(channel.NewPicker(reg, channel.NewStatsStore(), aff), adaptor.NewFactory(a), nil)
}

func TestNoKeyOrChannelReplayAfterAnyPush(t *testing.T) {
	for name, chunk := range map[string]openai.StreamChunk{
		"text":       {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "prefix"}}}},
		"reasoning":  {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{ReasoningContent: "reason"}}}},
		"tool":       {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{ToolCalls: json.RawMessage(`[{"index":0}]`)}}}},
		"usage":      {Usage: &openai.Usage{TotalTokens: 1}},
		"role":       {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Role: "assistant"}}}},
		"whitespace": {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: " "}}}},
	} {
		t.Run(name, func(t *testing.T) {
			ad := &progressAdaptor{chunk: &chunk}
			exec := progressExecutor(t, ad, true)
			_, err := exec.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, "m", channel.Identity{TenantID: "t", SessionID: "s"}, func(openai.StreamChunk) error { return nil })
			if err == nil || ad.aCalls != 1 || ad.bCalls != 0 {
				t.Fatalf("a=%d b=%d err=%v", ad.aCalls, ad.bCalls, err)
			}
		})
	}
}

func TestPushErrorCannotCauseFailover(t *testing.T) {
	chunk := openai.StreamChunk{ID: "first"}
	ad := &progressAdaptor{chunk: &chunk}
	exec := progressExecutor(t, ad, true)
	want := &adaptor.UpstreamError{StatusCode: 503, Body: "client callback failed after write"}
	_, err := exec.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, "m", channel.Identity{TenantID: "t", SessionID: "s"}, func(openai.StreamChunk) error { return want })
	if !errors.Is(err, want) || ad.aCalls != 1 || ad.bCalls != 0 {
		t.Fatalf("a=%d b=%d err=%v", ad.aCalls, ad.bCalls, err)
	}
}

func TestBeforeFirstPushStillFailsOver(t *testing.T) {
	ad := &progressAdaptor{}
	exec := progressExecutor(t, ad, true)
	_, err := exec.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, "m", channel.Identity{TenantID: "t", SessionID: "s"}, func(openai.StreamChunk) error { return nil })
	if err != nil || ad.aCalls != 2 || ad.bCalls != 1 {
		t.Fatalf("a=%d b=%d err=%v", ad.aCalls, ad.bCalls, err)
	}
}
