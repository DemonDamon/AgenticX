package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	ilink "github.com/openilink/openilink-sdk-go"
)

type sendRequest struct {
	Text         string `json:"text"`
	ContextToken string `json:"context_token,omitempty"`
	Recipient    string `json:"recipient,omitempty"`
	File         string `json:"file,omitempty"`
	Filename     string `json:"filename,omitempty"`
	Caption      string `json:"caption,omitempty"`
}

type sendResponse struct {
	OK       bool   `json:"ok"`
	ClientID string `json:"client_id,omitempty"`
	Error    string `json:"error,omitempty"`
}

func handleSend(w http.ResponseWriter, r *http.Request) {
	client := getMonitorClient()
	if client == nil || !isMonitorRunning() {
		writeJSON(w, http.StatusServiceUnavailable, sendResponse{
			OK:    false,
			Error: "monitor not running",
		})
		return
	}

	var req sendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, sendResponse{OK: false, Error: "invalid request body"})
		return
	}

	ctx := r.Context()

	if req.File != "" {
		fileData, err := base64.StdEncoding.DecodeString(req.File)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, sendResponse{OK: false, Error: "invalid base64 file data"})
			return
		}
		filename := req.Filename
		if filename == "" {
			filename = "file"
		}
		err = client.SendMediaFile(ctx, req.Recipient, req.ContextToken, fileData, filename, req.Caption)
		if err != nil {
			slog.Error("send media file failed", "error", err)
			writeJSON(w, http.StatusBadGateway, sendResponse{OK: false, Error: fmt.Sprintf("send media: %v", err)})
			return
		}
		writeJSON(w, http.StatusOK, sendResponse{OK: true})
		return
	}

	if req.Text == "" {
		writeJSON(w, http.StatusBadRequest, sendResponse{OK: false, Error: "text is required"})
		return
	}

	var clientID string
	var err error

	if req.ContextToken != "" {
		clientID, err = client.SendText(ctx, req.Recipient, req.Text, req.ContextToken)
	} else {
		clientID, err = client.Push(ctx, req.Recipient, req.Text)
	}

	if err != nil {
		slog.Error("send text failed", "error", err, "recipient", req.Recipient)
		writeJSON(w, http.StatusBadGateway, sendResponse{OK: false, Error: fmt.Sprintf("send: %v", err)})
		return
	}

	writeJSON(w, http.StatusOK, sendResponse{OK: true, ClientID: clientID})
}

type mediaDownloadRequest struct {
	EQP    string `json:"eqp"`
	AESKey string `json:"aes_key"`
	URL    string `json:"url"`
}

func handleMediaDownload(w http.ResponseWriter, r *http.Request) {
	client := getMonitorClient()
	if client == nil || !isMonitorRunning() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "monitor not running"})
		return
	}

	var req mediaDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	if req.EQP == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "eqp required"})
		return
	}

	ctx := r.Context()

	data, err := client.DownloadMedia(ctx, &ilink.CDNMedia{
		EncryptQueryParam: req.EQP,
		AESKey:            req.AESKey,
		FullURL:           req.URL,
	})
	if err != nil {
		slog.Error("media download failed", "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("download: %v", err)})
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}

type voiceDownloadRequest struct {
	EQP        string `json:"eqp"`
	AESKey     string `json:"aes_key"`
	SampleRate int    `json:"sample_rate"`
}

func handleVoiceDownload(w http.ResponseWriter, r *http.Request) {
	client := getMonitorClient()
	if client == nil || !isMonitorRunning() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "monitor not running"})
		return
	}

	var req voiceDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	if req.EQP == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "eqp required"})
		return
	}

	sr := req.SampleRate
	if sr <= 0 {
		sr = 24000
	}

	ctx := r.Context()
	data, err := client.DownloadVoice(ctx, &ilink.VoiceItem{
		Media:      &ilink.CDNMedia{EncryptQueryParam: req.EQP, AESKey: req.AESKey},
		SampleRate: sr,
	})
	if err != nil {
		slog.Error("voice download failed, trying raw", "error", err)
		data, err = client.DownloadMedia(ctx, &ilink.CDNMedia{
			EncryptQueryParam: req.EQP, AESKey: req.AESKey,
		})
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("download: %v", err)})
			return
		}
		w.Header().Set("Content-Type", "audio/silk")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
		_, _ = w.Write(data)
		return
	}

	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}
