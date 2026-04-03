package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	ilink "github.com/openilink/openilink-sdk-go"
)

type pendingBind struct {
	client *ilink.Client
	qrCode string
}

var (
	pendingBindsMu sync.Mutex
	pendingBinds   = make(map[string]*pendingBind)
	wsUpgrader     = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

type bindStartResponse struct {
	SessionID string `json:"session_id"`
	QRURL     string `json:"qr_url"`
}

func handleBindStart(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	client := ilink.NewClient("")
	qrResp, err := client.FetchQRCode(ctx)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("fetch QR code: %v", err)})
		return
	}

	sessionID := fmt.Sprintf("bind-%d", time.Now().UnixMilli())

	pendingBindsMu.Lock()
	pendingBinds[sessionID] = &pendingBind{
		client: client,
		qrCode: qrResp.QRCode,
	}
	pendingBindsMu.Unlock()

	qrURL := "data:image/png;base64," + qrResp.QRCodeImgContent

	writeJSON(w, http.StatusOK, bindStartResponse{
		SessionID: sessionID,
		QRURL:     qrURL,
	})

	slog.Info("bind session created", "session_id", sessionID)
}

type wsEvent struct {
	Event string `json:"event"`
	Status string `json:"status,omitempty"`
	BotID  string `json:"bot_id,omitempty"`
	QRURL  string `json:"qr_url,omitempty"`
	Error  string `json:"error,omitempty"`
}

func handleBindWS(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("session")
	if sessionID == "" {
		http.Error(w, "missing session id", http.StatusBadRequest)
		return
	}

	pendingBindsMu.Lock()
	pb, ok := pendingBinds[sessionID]
	pendingBindsMu.Unlock()
	if !ok {
		http.Error(w, "unknown session", http.StatusNotFound)
		return
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = conn.WriteJSON(wsEvent{Event: "status", Status: "timeout"})
			cleanupBind(sessionID)
			return
		case <-ticker.C:
			statusResp, err := pb.client.PollQRStatus(ctx, pb.qrCode)
			if err != nil {
				slog.Warn("poll QR status error", "error", err, "session", sessionID)
				_ = conn.WriteJSON(wsEvent{Event: "error", Error: err.Error()})
				continue
			}

			switch statusResp.Status {
			case "wait":
				_ = conn.WriteJSON(wsEvent{Event: "status", Status: "wait"})
			case "scaned", "scanned":
				_ = conn.WriteJSON(wsEvent{Event: "status", Status: "scanned"})

			case "expired":
				slog.Info("QR expired, refreshing", "session", sessionID)
				qrResp, err := pb.client.FetchQRCode(ctx)
				if err != nil {
					_ = conn.WriteJSON(wsEvent{Event: "error", Error: fmt.Sprintf("refresh QR: %v", err)})
					continue
				}
				pb.qrCode = qrResp.QRCode
				qrURL := "data:image/png;base64," + qrResp.QRCodeImgContent
				_ = conn.WriteJSON(wsEvent{Event: "status", Status: "expired", QRURL: qrURL})

			case "confirmed":
				creds := &Credentials{
					BotID:       statusResp.ILinkBotID,
					BotToken:    statusResp.BotToken,
					BaseURL:     statusResp.BaseURL,
					ILinkUserID: statusResp.ILinkUserID,
				}

				if err := saveCredentials(globalDataDir, creds); err != nil {
					slog.Error("save credentials failed", "error", err)
					_ = conn.WriteJSON(wsEvent{Event: "error", Error: "failed to save credentials"})
					cleanupBind(sessionID)
					return
				}

				setCredentials(creds)
				go startMonitor(creds)

				_ = conn.WriteJSON(wsEvent{
					Event:  "status",
					Status: "confirmed",
					BotID:  creds.BotID,
				})

				slog.Info("bind confirmed", "session", sessionID, "bot_id", creds.BotID)
				cleanupBind(sessionID)
				return
			}
		}
	}
}

func cleanupBind(sessionID string) {
	pendingBindsMu.Lock()
	delete(pendingBinds, sessionID)
	pendingBindsMu.Unlock()
}
