package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	ilink "github.com/openilink/openilink-sdk-go"
)

const keepaliveCheckInterval = 30 * time.Minute
const keepaliveThreshold = 22 * time.Hour

type SSEEvent struct {
	Type         string        `json:"type"`
	Sender       string        `json:"sender,omitempty"`
	Text         string        `json:"text,omitempty"`
	ContextToken string        `json:"context_token,omitempty"`
	Items        []MessageItem `json:"items,omitempty"`
	SessionID    string        `json:"session_id,omitempty"`
	GroupID      string        `json:"group_id,omitempty"`
	MessageID    string        `json:"message_id,omitempty"`
	Status       string        `json:"status,omitempty"`
}

type MessageItem struct {
	Type   int    `json:"type"`
	Text   string `json:"text,omitempty"`
	URL    string `json:"url,omitempty"`
	Name   string `json:"name,omitempty"`
	Size   int64  `json:"size,omitempty"`
	EQP    string `json:"eqp,omitempty"`
	AESKey string `json:"aes_key,omitempty"`
}

var (
	monitorMu          sync.Mutex
	monitorCancel      context.CancelFunc
	monitorRunning     bool
	monitorClient      *ilink.Client
	lastMessageTime    time.Time
	keepaliveCancel    context.CancelFunc

	sseMu      sync.Mutex
	sseClients []chan SSEEvent
)

func isMonitorRunning() bool {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	return monitorRunning
}

func startMonitor(creds *Credentials) {
	monitorMu.Lock()
	if monitorRunning && monitorCancel != nil {
		monitorCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	monitorCancel = cancel
	monitorRunning = true
	monitorMu.Unlock()

	slog.Info("starting monitor", "bot_id", creds.BotID)

	client := ilink.NewClient(creds.BotToken, ilink.WithBaseURL(creds.BaseURL))

	monitorMu.Lock()
	monitorClient = client
	monitorMu.Unlock()

	monitorMu.Lock()
	lastMessageTime = time.Now()
	monitorMu.Unlock()

	kaCtx, kaCancel := context.WithCancel(ctx)
	monitorMu.Lock()
	keepaliveCancel = kaCancel
	monitorMu.Unlock()
	go keepaliveLoop(kaCtx, creds)

	handler := func(msg ilink.WeixinMessage) {
		monitorMu.Lock()
		lastMessageTime = time.Now()
		monitorMu.Unlock()
		evt := convertMessage(msg)
		broadcastSSE(evt)
	}

	opts := &ilink.MonitorOptions{
		OnError: func(err error) {
			slog.Error("monitor error", "error", err)
			broadcastSSE(SSEEvent{Type: "error", Status: err.Error()})
		},
		OnSessionExpired: func() {
			slog.Warn("iLink session expired")
			broadcastSSE(SSEEvent{Type: "status", Status: "session_expired"})
			monitorMu.Lock()
			monitorRunning = false
			monitorMu.Unlock()
		},
	}

	err := client.Monitor(ctx, handler, opts)
	if err != nil && ctx.Err() == nil {
		slog.Error("monitor exited with error", "error", err)
		broadcastSSE(SSEEvent{Type: "error", Status: fmt.Sprintf("monitor stopped: %v", err)})
	}

	monitorMu.Lock()
	monitorRunning = false
	monitorClient = nil
	monitorMu.Unlock()

	slog.Info("monitor stopped")
}

func stopMonitor() {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	if keepaliveCancel != nil {
		keepaliveCancel()
		keepaliveCancel = nil
	}
	if monitorCancel != nil {
		monitorCancel()
		monitorCancel = nil
	}
	monitorRunning = false
	monitorClient = nil
}

func keepaliveLoop(ctx context.Context, creds *Credentials) {
	ticker := time.NewTicker(keepaliveCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			monitorMu.Lock()
			elapsed := time.Since(lastMessageTime)
			client := monitorClient
			monitorMu.Unlock()

			if client == nil || elapsed < keepaliveThreshold {
				continue
			}
			slog.Info("session keepalive: sending nudge", "idle_hours", int(elapsed.Hours()))
			broadcastSSE(SSEEvent{Type: "status", Status: "keepalive_sent"})
		}
	}
}

func getMonitorClient() *ilink.Client {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	return monitorClient
}

func convertMessage(msg ilink.WeixinMessage) SSEEvent {
	evt := SSEEvent{
		Type:         "message",
		Sender:       msg.FromUserID,
		ContextToken: msg.ContextToken,
		SessionID:    msg.SessionID,
		GroupID:      msg.GroupID,
		MessageID:    fmt.Sprintf("%d", msg.MessageID),
	}

	items := make([]MessageItem, 0, len(msg.ItemList))
	for _, item := range msg.ItemList {
		mi := MessageItem{Type: int(item.Type)}
		switch item.Type {
		case ilink.ItemText:
			if item.TextItem != nil {
				mi.Text = item.TextItem.Text
				if evt.Text == "" {
					evt.Text = item.TextItem.Text
				}
			}
		case ilink.ItemImage:
			if item.ImageItem != nil {
				mi.URL = item.ImageItem.URL
				if item.ImageItem.Media != nil {
					mi.EQP = item.ImageItem.Media.EncryptQueryParam
					mi.AESKey = item.ImageItem.Media.AESKey
				}
			}
		case ilink.ItemVoice:
			if item.VoiceItem != nil {
				mi.Text = item.VoiceItem.Text
				if item.VoiceItem.Media != nil {
					mi.EQP = item.VoiceItem.Media.EncryptQueryParam
					mi.AESKey = item.VoiceItem.Media.AESKey
				}
			}
		case ilink.ItemFile:
			if item.FileItem != nil {
				mi.Name = item.FileItem.FileName
				if item.FileItem.Media != nil {
					mi.EQP = item.FileItem.Media.EncryptQueryParam
					mi.AESKey = item.FileItem.Media.AESKey
				}
			}
		case ilink.ItemVideo:
			if item.VideoItem != nil && item.VideoItem.Media != nil {
				mi.EQP = item.VideoItem.Media.EncryptQueryParam
				mi.AESKey = item.VideoItem.Media.AESKey
			}
		}
		items = append(items, mi)
	}
	evt.Items = items

	return evt
}

func broadcastSSE(evt SSEEvent) {
	sseMu.Lock()
	defer sseMu.Unlock()
	for _, ch := range sseClients {
		select {
		case ch <- evt:
		default:
			// slow client, drop event
		}
	}
}

func registerSSEClient() chan SSEEvent {
	ch := make(chan SSEEvent, 64)
	sseMu.Lock()
	sseClients = append(sseClients, ch)
	sseMu.Unlock()
	return ch
}

func unregisterSSEClient(ch chan SSEEvent) {
	sseMu.Lock()
	defer sseMu.Unlock()
	for i, c := range sseClients {
		if c == ch {
			sseClients = append(sseClients[:i], sseClients[i+1:]...)
			break
		}
	}
	close(ch)
}

func handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := registerSSEClient()
	defer unregisterSSEClient(ch)

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case evt := <-ch:
			data, err := json.Marshal(evt)
			if err != nil {
				slog.Error("marshal SSE event", "error", err)
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}
