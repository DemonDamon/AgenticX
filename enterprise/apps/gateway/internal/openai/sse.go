package openai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/streamio"
)

var ErrIncompleteStream = errors.New("stream:incomplete")

// ReadSSE preserves the complete stream pivot and requires a protocol terminal,
// whether the caller uses a direct provider or a channel adapter.
func ReadSSE(ctx context.Context, body io.Reader, cfg streamio.Config, push func(StreamChunk) error) error {
	terminal := false
	err := streamio.ReadSSE(ctx, body, cfg, func(event streamio.Event) (bool, error) {
		payload := event.Data
		if payload == "" {
			return false, nil
		}
		if payload == "[DONE]" {
			terminal = true
			return true, nil
		}
		var envelope struct {
			Error *struct {
				Message string `json:"message"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(payload), &envelope) == nil && envelope.Error != nil {
			message := strings.TrimSpace(envelope.Error.Message)
			if message == "" {
				message = "upstream stream error"
			}
			if code := strings.TrimSpace(envelope.Error.Code); code != "" {
				return false, fmt.Errorf("upstream stream error %s: %s", code, message)
			}
			return false, fmt.Errorf("upstream stream error: %s", message)
		}
		if event.Name == "error" {
			return false, fmt.Errorf("upstream stream error: %s", payload)
		}
		var chunk StreamChunk
		if json.Unmarshal([]byte(payload), &chunk) != nil {
			return false, nil
		}
		if chunk.ID == "" && chunk.Object == "" && len(chunk.Choices) == 0 && chunk.Usage == nil {
			return false, nil
		}
		for _, choice := range chunk.Choices {
			if choice.FinishReason != nil && strings.TrimSpace(*choice.FinishReason) != "" {
				terminal = true
			}
		}
		return false, push(chunk)
	})
	if err != nil {
		return err
	}
	if !terminal {
		return ErrIncompleteStream
	}
	return nil
}
