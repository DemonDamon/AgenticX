package mcphost

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// StreamableHTTPTransport implements MCP streamable HTTP (single POST endpoint).
type StreamableHTTPTransport struct{}

func (StreamableHTTPTransport) Name() string { return "streamable-http" }

func writeRPCResponse(w http.ResponseWriter, resp jsonRPCResponse) {
	if resp.Error != nil && resp.Error.Code == -32029 {
		w.WriteHeader(http.StatusTooManyRequests)
	}
	writeRPC(w, resp)
}

func (t StreamableHTTPTransport) Handle(w http.ResponseWriter, r *http.Request, host *Host, rec *ServerRecord, identity Identity) error {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return err
	}
	req, err := parseJSONRPC(body)
	if err != nil {
		writeRPC(w, rpcErr(nil, -32700, "parse error"))
		return nil
	}
	resp := host.dispatchRPC(r.Context(), rec, identity, req)
	if req.Method == "notifications/initialized" {
		w.WriteHeader(http.StatusAccepted)
		return nil
	}
	writeRPCResponse(w, resp)
	return nil
}

func writeRPC(w http.ResponseWriter, resp jsonRPCResponse) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// SSETransport implements legacy MCP SSE + POST /messages flow.
type SSETransport struct {
	sessions *sseSessionStore
}

func NewSSETransport() *SSETransport {
	return &SSETransport{sessions: newSSESessionStore()}
}

func (SSETransport) Name() string { return "sse" }

func (t *SSETransport) Handle(w http.ResponseWriter, r *http.Request, host *Host, rec *ServerRecord, identity Identity) error {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return nil
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return nil
	}
	sessionID := t.sessions.Create(rec.Name, identity)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-MCP-Session-Id", sessionID)
	base := strings.TrimSuffix(r.URL.Path, "/sse")
	msgURL := base + "/messages?session=" + sessionID
	_, _ = w.Write([]byte("event: endpoint\ndata: " + msgURL + "\n\n"))
	flusher.Flush()
	// Keep connection open briefly; real clients reconnect as needed.
	select {
	case <-r.Context().Done():
		t.sessions.Remove(sessionID)
	}
	return nil
}

func (t *SSETransport) HandleMessages(w http.ResponseWriter, r *http.Request, host *Host, rec *ServerRecord, identity Identity) error {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return nil
	}
	sessionID := strings.TrimSpace(r.URL.Query().Get("session"))
	if sessionID != "" && !t.sessions.Valid(sessionID, rec.Name, identity) {
		http.Error(w, "invalid session", http.StatusBadRequest)
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return err
	}
	req, err := parseJSONRPC(body)
	if err != nil {
		writeRPC(w, rpcErr(nil, -32700, "parse error"))
		return nil
	}
	resp := host.dispatchRPC(r.Context(), rec, identity, req)
	if req.Method == "notifications/initialized" {
		w.WriteHeader(http.StatusAccepted)
		return nil
	}
	writeRPCResponse(w, resp)
	return nil
}
