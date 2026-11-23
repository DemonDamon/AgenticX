package relay

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/virtualmodel"
)

func TestStreamDoesNotSwitchVirtualTargetAfterOutput(t *testing.T) {
	var bHits atomic.Int32
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		bHits.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseContent("from-b") + "data: [DONE]\n\n"))
	}))
	defer b.Close()
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeSSEThenReset(t, w, sseContent("a1"), sseContent("a2"))
	}))
	defer a.Close()

	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot([]channel.Channel{
		{
			ID: "real-a", TenantID: "t1", ProviderType: "openai", BaseURL: a.URL, APIKey: "k",
			Status: channel.StatusActive, SupportedModels: []string{"real-a"}, Weight: 1,
		},
		{
			ID: "real-b", TenantID: "t1", ProviderType: "openai", BaseURL: b.URL, APIKey: "k",
			Status: channel.StatusActive, SupportedModels: []string{"real-b"}, Weight: 1,
		},
	})
	picker := channel.NewPicker(reg, channel.NewStatsStore(), channel.NewAffinityStore(0))
	exec := NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool())
	loader := virtualmodel.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	loader.SetSnapshot([]virtualmodel.Model{{
		TenantID:    "t1",
		Name:        "virt",
		DisplayName: "Virt",
		Enabled:     true,
		Targets: []virtualmodel.Target{
			{Model: "real-a", Weight: 1, Priority: 0},
			{Model: "real-b", Weight: 1, Priority: 1},
		},
	}})
	exec.SetVirtualPlanner(loader)

	var got []string
	result, err := exec.Stream(context.Background(), openai.ChatCompletionRequest{
		Model:    "virt",
		Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("hi")}},
	}, "virt", channel.Identity{TenantID: "t1"}, func(chunk openai.StreamChunk) error {
		if len(chunk.Choices) > 0 {
			got = append(got, chunk.Choices[0].Delta.Content)
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected error after partial output")
	}
	if len(got) != 2 || got[0] != "a1" || got[1] != "a2" {
		t.Fatalf("push got %#v, want [a1 a2]", got)
	}
	if bHits.Load() != 0 {
		t.Fatalf("fallback target calls = %d, want 0", bHits.Load())
	}
	if result.ResolvedModel != "real-a" || result.VirtualName != "virt" {
		t.Fatalf("result model = %q virtual = %q", result.ResolvedModel, result.VirtualName)
	}
}

func TestExecutorUsesAdmissionPlanInsteadOfSamplingAgain(t *testing.T) {
	var heavyHits atomic.Int32
	heavy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		heavyHits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"heavy"}}]}`))
	}))
	defer heavy.Close()
	light := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"light"}}]}`))
	}))
	defer light.Close()

	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot([]channel.Channel{
		{ID: "light", TenantID: "t1", ProviderType: "openai", BaseURL: light.URL, APIKey: "k", Status: channel.StatusActive, SupportedModels: []string{"real-light"}, Weight: 1},
		{ID: "heavy", TenantID: "t1", ProviderType: "openai", BaseURL: heavy.URL, APIKey: "k", Status: channel.StatusActive, SupportedModels: []string{"real-heavy"}, Weight: 1},
	})
	exec := NewExecutor(channel.NewPicker(reg, channel.NewStatsStore(), channel.NewAffinityStore(0)), adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool())
	loader := virtualmodel.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	loader.SetSnapshot([]virtualmodel.Model{{
		TenantID: "t1", Name: "virt", Enabled: true,
		Targets: []virtualmodel.Target{
			{Model: "real-light", Weight: 1, Priority: 0},
			{Model: "real-heavy", Weight: 100, Priority: 0},
		},
	}})
	exec.SetVirtualPlanner(loader)
	ctx := virtualmodel.WithPlan(context.Background(), []string{"real-light", "real-heavy"}, "virt")
	result, err := exec.Complete(ctx, openai.ChatCompletionRequest{
		Model:    "virt",
		Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("hi")}},
	}, "virt", channel.Identity{TenantID: "t1"})
	if err != nil {
		t.Fatal(err)
	}
	if result.ResolvedModel != "real-light" || result.Channel.ID != "light" {
		t.Fatalf("resolved %q channel %q, want the admission plan's first model", result.ResolvedModel, result.Channel.ID)
	}
	if heavyHits.Load() != 0 {
		t.Fatalf("heavy target calls = %d, want 0", heavyHits.Load())
	}
}
