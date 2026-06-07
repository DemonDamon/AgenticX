package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/agenticx/enterprise/edge-agent/internal/trace"
)

const (
	HeaderTraceID  = "X-AgenticX-Trace-Id"
	HeaderTraceStep = "X-AgenticX-Trace-Step"
)

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		token:   strings.TrimSpace(token),
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

type chatRequest struct {
	Model    string              `json:"model"`
	Messages []chatMessage       `json:"messages"`
	Stream   bool                `json:"stream"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// Complete calls the enterprise gateway chat completions endpoint with trace headers.
func (c *Client) Complete(ctx context.Context, traceID string, stepNo int, model, prompt string) (trace.Usage, error) {
	if c.baseURL == "" {
		return trace.Usage{}, fmt.Errorf("gateway base url not configured")
	}
	body, err := json.Marshal(chatRequest{
		Model: model,
		Messages: []chatMessage{
			{Role: "user", Content: prompt},
		},
		Stream: false,
	})
	if err != nil {
		return trace.Usage{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return trace.Usage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	req.Header.Set(HeaderTraceID, traceID)
	req.Header.Set(HeaderTraceStep, strconv.Itoa(stepNo))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return trace.Usage{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return trace.Usage{}, err
	}
	if resp.StatusCode >= 300 {
		return trace.Usage{}, fmt.Errorf("gateway status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var parsed chatResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return trace.Usage{}, err
	}
	total := parsed.Usage.TotalTokens
	if total == 0 {
		total = parsed.Usage.PromptTokens + parsed.Usage.CompletionTokens
	}
	return trace.Usage{
		InputTokens:  parsed.Usage.PromptTokens,
		OutputTokens: parsed.Usage.CompletionTokens,
		TotalTokens:  total,
	}, nil
}
