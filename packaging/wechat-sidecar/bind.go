package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	ilink "github.com/openilink/openilink-sdk-go"
	qrcode "github.com/skip2/go-qrcode"
)

type pendingBind struct {
	mu             sync.RWMutex
	client         *ilink.Client
	qrCode         string
	qrImagePayload string
	cachedQRBytes  []byte
	cachedQRCT     string
}

func (p *pendingBind) getQRCode() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.qrCode
}

func (p *pendingBind) getQRImagePayload() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.qrImagePayload
}

func (p *pendingBind) updateQR(qrCode, qrImagePayload string) {
	p.mu.Lock()
	p.qrCode = qrCode
	p.qrImagePayload = qrImagePayload
	p.mu.Unlock()
}

func (p *pendingBind) getCachedQR() (string, []byte) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cachedQRCT, p.cachedQRBytes
}

func (p *pendingBind) setCachedQR(ct string, data []byte) {
	p.mu.Lock()
	p.cachedQRCT = ct
	p.cachedQRBytes = data
	p.mu.Unlock()
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

const maxQRImageBytes = 5 << 20 // 5MB

var (
	dataImageInHTMLRegex = regexp.MustCompile(`(?is)data:image/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+`)
	imgSrcInHTMLRegex    = regexp.MustCompile(`(?is)<img[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')`)
	jsImageURLRegex      = regexp.MustCompile(`(?i)https?://[^\s"'<>\\)]+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>\\)]*)?`)
)

func normalizeQRDataURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "data:image/") {
		return trimmed
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	return "data:image/png;base64," + trimmed
}

func detectQRFormat(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "empty"
	}
	if strings.HasPrefix(trimmed, "data:image/") {
		return "data"
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return "http"
	}
	return "base64"
}

func sanitizeImageContentType(raw string) string {
	const fallback = "image/png"
	allowed := map[string]struct{}{
		"image/png":                {},
		"image/jpeg":               {},
		"image/jpg":                {},
		"image/webp":               {},
		"image/gif":                {},
		"image/bmp":                {},
		"image/svg+xml":            {},
		"image/x-icon":             {},
		"image/vnd.microsoft.icon": {},
	}

	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}

	mediaType, _, err := mime.ParseMediaType(trimmed)
	if err != nil {
		return fallback
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if _, ok := allowed[mediaType]; ok {
		if mediaType == "image/jpg" {
			return "image/jpeg"
		}
		if mediaType == "image/vnd.microsoft.icon" {
			return "image/x-icon"
		}
		return mediaType
	}
	return fallback
}

func sniffQRImageContentType(body []byte) (string, error) {
	if len(body) == 0 {
		return "", errors.New("empty image body")
	}

	sniffLen := len(body)
	if sniffLen > 512 {
		sniffLen = 512
	}
	chunk := body[:sniffLen]

	detected := strings.TrimSpace(strings.ToLower(http.DetectContentType(chunk)))
	mediaType, _, err := mime.ParseMediaType(detected)
	if err == nil {
		detected = strings.ToLower(strings.TrimSpace(mediaType))
	}

	switch detected {
	case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon":
		return detected, nil
	case "image/svg+xml", "text/xml", "application/xml", "text/plain":
		// Some SVG payloads are sniffed as text/xml; only trust if markup is present.
		if bytes.Contains(bytes.ToLower(chunk), []byte("<svg")) {
			return "image/svg+xml", nil
		}
	}

	return "", fmt.Errorf("non-image payload detected: %s", detected)
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
		client:         client,
		qrCode:         qrResp.QRCode,
		qrImagePayload: qrResp.QRCodeImgContent,
	}
	pendingBindsMu.Unlock()

	qrFormat := detectQRFormat(qrResp.QRCodeImgContent)
	slog.Info("bind QR format detected", "session_id", sessionID, "qr_format", qrFormat)

	ct, qrBytes, resolveErr := resolveQRImage(qrResp.QRCodeImgContent)
	if resolveErr != nil {
		slog.Warn("eager QR resolve failed, will retry on /qr", "session", sessionID, "error", resolveErr)
	} else {
		pendingBindsMu.Lock()
		if pb, ok := pendingBinds[sessionID]; ok {
			pb.setCachedQR(ct, qrBytes)
		}
		pendingBindsMu.Unlock()
		slog.Info("eager QR resolved", "session", sessionID, "content_type", ct, "size", len(qrBytes))
	}

	qrURL := fmt.Sprintf("/bind/%s/qr", sessionID)

	writeJSON(w, http.StatusOK, bindStartResponse{
		SessionID: sessionID,
		QRURL:     qrURL,
	})

	slog.Info("bind session created", "session_id", sessionID)
}

func decodeBase64Payload(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("empty payload")
	}
	trimmed = strings.ReplaceAll(trimmed, "\n", "")
	trimmed = strings.ReplaceAll(trimmed, "\r", "")
	trimmed = strings.ReplaceAll(trimmed, "\t", "")
	trimmed = strings.ReplaceAll(trimmed, " ", "")

	if b, err := base64.StdEncoding.DecodeString(trimmed); err == nil && len(b) > 0 {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil && len(b) > 0 {
		return b, nil
	}
	if b, err := base64.URLEncoding.DecodeString(trimmed); err == nil && len(b) > 0 {
		return b, nil
	}
	if b, err := base64.RawURLEncoding.DecodeString(trimmed); err == nil && len(b) > 0 {
		return b, nil
	}
	return nil, errors.New("invalid base64 payload")
}

func extractDataURLPayload(raw string) (string, []byte, error) {
	parts := strings.SplitN(strings.TrimSpace(raw), ",", 2)
	if len(parts) != 2 {
		return "", nil, errors.New("invalid data url")
	}
	meta := strings.TrimSpace(parts[0])
	payload := strings.TrimSpace(parts[1])
	if !strings.HasPrefix(strings.ToLower(meta), "data:") {
		return "", nil, errors.New("invalid data url")
	}
	contentType := "image/png"
	if media := strings.TrimPrefix(meta, "data:"); media != "" {
		if seg := strings.Split(media, ";")[0]; strings.TrimSpace(seg) != "" {
			contentType = sanitizeImageContentType(seg)
		}
	}
	data, err := decodeBase64Payload(payload)
	if err != nil {
		return "", nil, err
	}
	return contentType, data, nil
}

func fetchQRImageBytes(imageURL string) (string, []byte, error) {
	return fetchQRImageBytesWithDepth(imageURL, 0)
}

func fetchQRImageBytesWithDepth(imageURL string, depth int) (string, []byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return "", nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxQRImageBytes+1))
	if err != nil {
		return "", nil, err
	}
	if len(body) == 0 || len(body) > maxQRImageBytes {
		return "", nil, errors.New("invalid body size")
	}

	if contentType, err := sniffQRImageContentType(body); err == nil {
		return contentType, body, nil
	} else if isTextLikeContentType(resp.Header.Get("Content-Type")) {
		hit, extracted := extractImageSourceFromHTML(body)
		logQRHTMLParseHit(hit, imageURL, extracted)

		switch hit {
		case "data":
			_, imageBytes, err := extractDataURLPayload(extracted)
			if err != nil {
				return "", nil, err
			}
			contentType, err := sniffQRImageContentType(imageBytes)
			if err != nil {
				return "", nil, err
			}
			return contentType, imageBytes, nil
		case "img_src", "js_url":
			if depth >= 1 {
				return "", nil, errors.New("html fallback exceeded max recursion")
			}
			resolved, err := resolveImageURL(imageURL, extracted)
			if err != nil {
				return "", nil, err
			}
			return fetchQRImageBytesWithDepth(resolved, depth+1)
		default:
			return "", nil, err
		}
	} else {
		return "", nil, err
	}
}

func isTextLikeContentType(raw string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/xml", "text/xml", "application/xhtml+xml":
		return true
	default:
		return false
	}
}

func extractImageSourceFromHTML(body []byte) (string, string) {
	raw := string(body)
	if m := dataImageInHTMLRegex.FindString(raw); m != "" {
		return "data", m
	}
	if m := imgSrcInHTMLRegex.FindStringSubmatch(raw); len(m) >= 3 {
		src := strings.TrimSpace(m[1])
		if src == "" {
			src = strings.TrimSpace(m[2])
		}
		if src != "" {
			return "img_src", src
		}
	}
	if m := jsImageURLRegex.FindString(raw); m != "" {
		return "js_url", strings.TrimSpace(m)
	}
	return "none", ""
}

func resolveImageURL(baseURL, raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", errors.New("empty extracted image source")
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed, nil
	}
	baseParsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	relParsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	return baseParsed.ResolveReference(relParsed).String(), nil
}

func generateQRFromURL(rawURL string) (string, []byte, error) {
	png, err := qrcode.Encode(rawURL, qrcode.Medium, 512)
	if err != nil {
		return "", nil, fmt.Errorf("generate QR code: %w", err)
	}
	return "image/png", png, nil
}

func hostFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "<invalid>"
	}
	return parsed.Host
}

func sanitizeURLForLog(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func logQRHTMLParseHit(hit, sourceURL, extracted string) {
	attrs := []any{
		"html_parse_hit", hit,
		"source", sanitizeURLForLog(sourceURL),
	}
	if hit == "img_src" || hit == "js_url" {
		attrs = append(attrs, "extracted", sanitizeURLForLog(extracted))
	}
	slog.Info("qr html fallback parse", attrs...)
}

func resolveQRImage(raw string) (string, []byte, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil, errors.New("missing qr payload")
	}
	if strings.HasPrefix(trimmed, "data:image/") {
		return extractDataURLPayload(trimmed)
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		ct, data, err := fetchQRImageBytes(trimmed)
		if err == nil {
			return ct, data, nil
		}
		slog.Info("generated QR from URL",
			"url_host", hostFromURL(trimmed),
			"fetch_error", err,
		)
		return generateQRFromURL(trimmed)
	}
	data, err := decodeBase64Payload(trimmed)
	if err != nil {
		return "", nil, err
	}
	return "image/png", data, nil
}

func handleBindQR(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("session")
	if sessionID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bind session or qr unavailable"})
		return
	}

	pendingBindsMu.Lock()
	pb, ok := pendingBinds[sessionID]
	pendingBindsMu.Unlock()
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bind session or qr unavailable"})
		return
	}

	ct, data := pb.getCachedQR()
	if len(data) > 0 && ct != "" {
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "no-store, max-age=0")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}

	contentType, imageBytes, err := resolveQRImage(pb.getQRImagePayload())
	if err != nil {
		slog.Warn("resolve bind qr failed", "session", sessionID, "error", err)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bind session or qr unavailable"})
		return
	}

	pb.setCachedQR(contentType, imageBytes)

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(imageBytes)
}

type wsEvent struct {
	Event  string `json:"event"`
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
			statusResp, err := pb.client.PollQRStatus(ctx, pb.getQRCode())
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
				pb.updateQR(qrResp.QRCode, qrResp.QRCodeImgContent)
				pb.setCachedQR("", nil)
				if ct, data, err := resolveQRImage(qrResp.QRCodeImgContent); err == nil {
					pb.setCachedQR(ct, data)
				}
				qrFormat := detectQRFormat(qrResp.QRCodeImgContent)
				qrURL := fmt.Sprintf("/bind/%s/qr?ts=%d", sessionID, time.Now().UnixMilli())
				slog.Info("bind QR refresh format detected", "session", sessionID, "qr_format", qrFormat)
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
