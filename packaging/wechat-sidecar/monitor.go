package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
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

type monitorLoopFunc func(ctx context.Context, creds *Credentials) error

var (
	monitorLifeMu            sync.Mutex
	monitorMu                sync.Mutex
	monitorCancel            context.CancelFunc
	monitorDone              chan struct{}
	monitorEpoch             uint64
	monitorRunning           bool
	monitorClient            *ilink.Client
	lastMessageTime          time.Time
	keepaliveCancel          context.CancelFunc
	consecutiveMonitorErrors int

	sseMu      sync.Mutex
	sseClients []chan SSEEvent

	runMonitorLoop monitorLoopFunc = runIlinkMonitorLoop
)

const stopMonitorWaitTimeout = 8 * time.Second

func isMonitorRunning() bool {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	return monitorRunning
}

func startMonitor(creds *Credentials) {
	monitorLifeMu.Lock()
	stopMonitorWait()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})

	monitorMu.Lock()
	monitorCancel = cancel
	monitorDone = done
	monitorEpoch++
	epoch := monitorEpoch
	monitorRunning = true
	lastMessageTime = time.Now()
	consecutiveMonitorErrors = 0
	monitorMu.Unlock()
	monitorLifeMu.Unlock()

	slog.Info("starting monitor", "bot_id", creds.BotID, "epoch", epoch)

	defer func() {
		close(done)
		finishMonitorGeneration(epoch, done)
		slog.Info("monitor stopped", "epoch", epoch)
	}()

	err := runMonitorLoop(ctx, creds)
	if err != nil && ctx.Err() == nil {
		slog.Error("monitor exited with error", "error", err, "epoch", epoch)
		broadcastSSE(SSEEvent{Type: "error", Status: fmt.Sprintf("monitor stopped: %v", err)})
	}
}

func finishMonitorGeneration(epoch uint64, done chan struct{}) {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	if epoch != monitorEpoch {
		return
	}
	monitorRunning = false
	monitorClient = nil
	consecutiveMonitorErrors = 0
	if monitorCancel != nil {
		monitorCancel = nil
	}
	if done != nil && monitorDone == done {
		monitorDone = nil
	}
}

func runIlinkMonitorLoop(ctx context.Context, creds *Credentials) error {
	client := ilink.NewClient(creds.BotToken, ilink.WithBaseURL(creds.BaseURL))

	monitorMu.Lock()
	monitorClient = client
	monitorMu.Unlock()

	kaCtx, kaCancel := context.WithCancel(ctx)
	monitorMu.Lock()
	keepaliveCancel = kaCancel
	monitorMu.Unlock()
	go keepaliveLoop(kaCtx, creds)

	handler := func(msg ilink.WeixinMessage) {
		monitorMu.Lock()
		lastMessageTime = time.Now()
		consecutiveMonitorErrors = 0
		monitorMu.Unlock()
		evt := convertMessage(msg)
		broadcastSSE(evt)
	}

	monitorMu.Lock()
	epoch := monitorEpoch
	monitorMu.Unlock()

	opts := &ilink.MonitorOptions{
		OnError: func(err error) {
			slog.Error("monitor error", "error", err)
			broadcastSSE(SSEEvent{Type: "error", Status: err.Error()})
			monitorMu.Lock()
			if epoch != monitorEpoch {
				monitorMu.Unlock()
				return
			}
			consecutiveMonitorErrors++
			if consecutiveMonitorErrors >= 3 {
				monitorRunning = false
				monitorClient = nil
				slog.Warn("monitor degraded to stale after consecutive errors", "count", consecutiveMonitorErrors)
				broadcastSSE(SSEEvent{Type: "status", Status: "stale"})
			}
			monitorMu.Unlock()
		},
		OnSessionExpired: func() {
			slog.Warn("iLink session expired")
			broadcastSSE(SSEEvent{Type: "status", Status: "session_expired"})
			monitorMu.Lock()
			if epoch != monitorEpoch {
				monitorMu.Unlock()
				return
			}
			monitorRunning = false
			consecutiveMonitorErrors = 0
			monitorMu.Unlock()
		},
	}

	return client.Monitor(ctx, handler, opts)
}

func stopMonitorWait() {
	monitorMu.Lock()
	if keepaliveCancel != nil {
		keepaliveCancel()
		keepaliveCancel = nil
	}
	cancel := monitorCancel
	done := monitorDone
	monitorCancel = nil
	monitorMu.Unlock()

	if cancel != nil {
		cancel()
	}
	if done == nil {
		return
	}
	select {
	case <-done:
	case <-time.After(stopMonitorWaitTimeout):
		slog.Warn("stopMonitor wait timed out")
	}
}

func stopMonitor() {
	monitorLifeMu.Lock()
	defer monitorLifeMu.Unlock()
	stopMonitorWait()
	monitorMu.Lock()
	if monitorCancel == nil {
		monitorRunning = false
		monitorClient = nil
		consecutiveMonitorErrors = 0
	}
	monitorMu.Unlock()
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

func pickCDNMedia(primary, fallback *ilink.CDNMedia) *ilink.CDNMedia {
	usable := func(m *ilink.CDNMedia) bool {
		return m != nil && (m.EncryptQueryParam != "" || m.FullURL != "")
	}
	if usable(primary) {
		return primary
	}
	if usable(fallback) {
		return fallback
	}
	if primary != nil {
		return primary
	}
	return fallback
}

func applyCDNMedia(mi *MessageItem, media *ilink.CDNMedia) {
	if mi == nil || media == nil {
		return
	}
	if media.EncryptQueryParam != "" {
		mi.EQP = media.EncryptQueryParam
	}
	if media.AESKey != "" {
		mi.AESKey = media.AESKey
	}
	if media.FullURL != "" {
		mi.URL = media.FullURL
	}
}

func fillImageFields(mi *MessageItem, img *ilink.ImageItem) {
	if mi == nil || img == nil {
		return
	}
	if mi.Type == 0 {
		mi.Type = int(ilink.ItemImage)
	}
	if img.URL != "" && mi.URL == "" {
		mi.URL = img.URL
	}
	applyCDNMedia(mi, pickCDNMedia(img.Media, img.ThumbMedia))
	if mi.AESKey == "" {
		mi.AESKey = img.AESKey
	}
}

func convertItem(item ilink.MessageItem) MessageItem {
	mi := MessageItem{Type: int(item.Type)}
	if item.TextItem != nil {
		mi.Text = item.TextItem.Text
		if mi.Type == 0 {
			mi.Type = int(ilink.ItemText)
		}
	}
	if item.ImageItem != nil {
		fillImageFields(&mi, item.ImageItem)
	}
	if item.VoiceItem != nil {
		mi.Text = item.VoiceItem.Text
		if mi.Type == 0 {
			mi.Type = int(ilink.ItemVoice)
		}
		applyCDNMedia(&mi, item.VoiceItem.Media)
	}
	if item.FileItem != nil {
		mi.Name = item.FileItem.FileName
		if mi.Type == 0 {
			mi.Type = int(ilink.ItemFile)
		}
		applyCDNMedia(&mi, item.FileItem.Media)
	}
	if item.VideoItem != nil {
		if mi.Type == 0 {
			mi.Type = int(ilink.ItemVideo)
		}
		applyCDNMedia(&mi, pickCDNMedia(item.VideoItem.Media, item.VideoItem.ThumbMedia))
	}
	return mi
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

	items := make([]MessageItem, 0, len(msg.ItemList)+1)
	for _, item := range msg.ItemList {
		mi := convertItem(item)
		if mi.Text != "" && evt.Text == "" {
			evt.Text = mi.Text
		}
		items = append(items, mi)
		if item.RefMsg != nil && item.RefMsg.MessageItem != nil {
			ref := convertItem(*item.RefMsg.MessageItem)
			if ref.Type != int(ilink.ItemText) && (ref.EQP != "" || ref.URL != "") {
				items = append(items, ref)
			}
		}
	}
	evt.Items = items
	dumpLastInbound(msg, evt)
	return evt
}

func dumpLastInbound(msg ilink.WeixinMessage, evt SSEEvent) {
	if globalDataDir == "" {
		return
	}
	payload, err := json.MarshalIndent(map[string]any{
		"raw": msg,
		"sse": evt,
	}, "", "  ")
	if err != nil {
		return
	}
	path := filepath.Join(globalDataDir, "wechat_last_inbound.json")
	_ = os.WriteFile(path, payload, 0600)
	slog.Info(
		"inbound weixin message",
		"sender", msg.FromUserID,
		"text_len", len(evt.Text),
		"items", len(evt.Items),
		"message_id", evt.MessageID,
	)
}

func broadcastSSE(evt SSEEvent) {
	sseMu.Lock()
	clients := append([]chan SSEEvent(nil), sseClients...)
	sseMu.Unlock()
	for _, ch := range clients {
		select {
		case ch <- evt:
		default:
			slog.Warn(
				"sse client buffer full, dropping inbound event",
				"type", evt.Type,
				"text_len", len(evt.Text),
				"items", len(evt.Items),
				"message_id", evt.MessageID,
			)
		}
	}
}

func registerSSEClient() chan SSEEvent {
	ch := make(chan SSEEvent, 256)
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

// getLastSuccessAt returns the RFC3339 UTC time of last successful message or start.
func getLastSuccessAt() string {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	if lastMessageTime.IsZero() {
		return ""
	}
	return lastMessageTime.UTC().Format(time.RFC3339)
}

// getConsecutiveErrors returns current error streak count (for health).
func getConsecutiveErrors() int {
	monitorMu.Lock()
	defer monitorMu.Unlock()
	return consecutiveMonitorErrors
}
