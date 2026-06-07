// Mock OpenAI-compatible upstream for gateway perf isolation.
// Fixed/adjustable latency + deterministic usage in responses.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	addr := flag.String("addr", envOr("MOCK_UPSTREAM_ADDR", "127.0.0.1:19099"), "listen address")
	defaultDelay := flag.Int("delay-ms", envInt("MOCK_UPSTREAM_DELAY_MS", 0), "default response delay in ms")
	flag.Parse()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/chat/completions", chatHandler(*defaultDelay))
	mux.HandleFunc("POST /chat/completions", chatHandler(*defaultDelay))

	log.Printf("mock upstream listening on http://%s delay_ms=%d", *addr, *defaultDelay)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		log.Fatal(err)
	}
}

func chatHandler(defaultDelay int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		delay := defaultDelay
		if raw := strings.TrimSpace(r.Header.Get("X-Mock-Delay-Ms")); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
				delay = n
			}
		}
		if delay > 0 {
			time.Sleep(time.Duration(delay) * time.Millisecond)
		}

		var req chatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		model := strings.TrimSpace(req.Model)
		if model == "" {
			model = "perf-mock-model"
		}
		promptTokens := estimateTokens(req.Messages)
		completionTokens := 12
		if req.Stream {
			streamResponse(w, model, promptTokens, completionTokens)
			return
		}
		writeJSON(w, http.StatusOK, chatResponse{
			ID:      "chatcmpl_mock_" + strconv.FormatInt(time.Now().UnixNano(), 10),
			Object:  "chat.completion",
			Created: time.Now().Unix(),
			Model:   model,
			Choices: []choice{{
				Index:        0,
				Message:      message{Role: "assistant", Content: "mock upstream ok"},
				FinishReason: "stop",
			}},
			Usage: usage{
				PromptTokens:     promptTokens,
				CompletionTokens: completionTokens,
				TotalTokens:      promptTokens + completionTokens,
			},
		})
	}
}

func streamResponse(w http.ResponseWriter, model string, promptTokens, completionTokens int) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	id := "chatcmpl_mock_stream"
	chunks := []string{"mock ", "stream ", "ok"}
	for _, part := range chunks {
		payload, _ := json.Marshal(map[string]any{
			"id":      id,
			"object":  "chat.completion.chunk",
			"created": time.Now().Unix(),
			"model":   model,
			"choices": []map[string]any{{
				"index": 0,
				"delta": map[string]string{"content": part},
			}},
		})
		fmt.Fprintf(w, "data: %s\n\n", payload)
		flusher.Flush()
	}
	final, _ := json.Marshal(map[string]any{
		"id":      id,
		"object":  "chat.completion.chunk",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{{
			"index":         0,
			"delta":         map[string]string{},
			"finish_reason": "stop",
		}},
		"usage": usage{
			PromptTokens:     promptTokens,
			CompletionTokens: completionTokens,
			TotalTokens:      promptTokens + completionTokens,
		},
	})
	fmt.Fprintf(w, "data: %s\n\n", final)
	fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

type chatRequest struct {
	Model    string    `json:"model"`
	Messages []message `json:"messages"`
	Stream   bool      `json:"stream"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type choice struct {
	Index        int     `json:"index"`
	Message      message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

type usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type chatResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"`
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []choice `json:"choices"`
	Usage   usage    `json:"usage"`
}

func estimateTokens(messages []message) int {
	total := 0
	for _, msg := range messages {
		total += len([]rune(msg.Content))/4 + 4
	}
	if total < 8 {
		return 8
	}
	return total
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}
