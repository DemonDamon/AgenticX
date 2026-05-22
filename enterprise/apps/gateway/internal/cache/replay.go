package cache

import (
	"encoding/json"
	"net/http"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// ReplayMode controls stream playback pacing.
type ReplayMode string

const (
	ReplayBurst    ReplayMode = "burst"
	ReplayRealTime ReplayMode = "real-time"
)

// WriteJSONResponse writes a cached non-stream response.
func WriteJSONResponse(w http.ResponseWriter, entry Entry) {
	writeJSON(w, http.StatusOK, entry.Response)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

// ReplayStream emits cached SSE chunks (burst mode by default).
func ReplayStream(w http.ResponseWriter, entry Entry, mode ReplayMode) error {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return errStreamingUnsupported
	}
	for _, chunk := range entry.StreamChunks {
		payload, err := json.Marshal(chunk)
		if err != nil {
			return err
		}
		if _, err := w.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
			return err
		}
		flusher.Flush()
		if mode == ReplayRealTime {
			// lightweight pacing placeholder; burst skips delay
		}
	}
	_, err := w.Write([]byte("data: [DONE]\n\n"))
	if err == nil {
		flusher.Flush()
	}
	return err
}

// BuildStreamEntry materializes a cache entry from collected stream chunks.
func BuildStreamEntry(chunks []openai.StreamChunk, usage openai.Usage, model string) Entry {
	return Entry{
		Stream:       true,
		StreamChunks: append([]openai.StreamChunk(nil), chunks...),
		Usage:        usage,
		Response: openai.ChatCompletionResponse{
			Model: model,
			Usage: usage,
		},
	}
}

var errStreamingUnsupported = &streamUnsupportedError{}

type streamUnsupportedError struct{}

func (e *streamUnsupportedError) Error() string { return "streaming unsupported" }
