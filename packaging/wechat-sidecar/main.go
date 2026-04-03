package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

var (
	globalDataDir string

	credsMu    sync.RWMutex
	storedCreds *Credentials
)

func setCredentials(creds *Credentials) {
	credsMu.Lock()
	storedCreds = creds
	credsMu.Unlock()
}

func getCredentials() *Credentials {
	credsMu.RLock()
	defer credsMu.RUnlock()
	return storedCreds
}

func main() {
	var port int
	var dataDir string

	flag.IntVar(&port, "port", 0, "HTTP listen port (0 = auto)")
	flag.StringVar(&dataDir, "data-dir", defaultDataDir(), "Data directory")
	flag.Parse()

	globalDataDir = dataDir

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		slog.Error("create data dir failed", "error", err)
		os.Exit(1)
	}

	creds, err := loadCredentials(dataDir)
	if err == nil {
		slog.Info("loaded existing credentials", "bot_id", creds.BotID)
		setCredentials(creds)
		go startMonitor(creds)
	} else {
		slog.Info("no existing credentials, waiting for bind")
	}

	mux := http.NewServeMux()

	mux.HandleFunc("POST /bind/start", handleBindStart)
	mux.HandleFunc("GET /bind/{session}/ws", handleBindWS)
	mux.HandleFunc("GET /status", handleStatus)
	mux.HandleFunc("POST /send", handleSend)
	mux.HandleFunc("GET /events", handleEvents)
	mux.HandleFunc("POST /reconnect", handleReconnect)
	mux.HandleFunc("POST /unbind", handleUnbind)
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /media/download", handleMediaDownload)
	mux.HandleFunc("POST /media/voice", handleVoiceDownload)

	handler := corsMiddleware(mux)

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		slog.Error("listen failed", "error", err)
		os.Exit(1)
	}

	actualPort := listener.Addr().(*net.TCPAddr).Port
	writePortFile(dataDir, actualPort)

	server := &http.Server{Handler: handler}

	go func() {
		slog.Info("wechat-sidecar listening", "port", actualPort)
		fmt.Printf("wechat-sidecar listening on :%d\n", actualPort)
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	slog.Info("shutting down")
	stopMonitor()
	removePortFile(dataDir)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
}

func handleStatus(w http.ResponseWriter, _ *http.Request) {
	creds := getCredentials()
	connected := isMonitorRunning()
	botID := ""
	status := "disconnected"

	if creds != nil {
		botID = creds.BotID
	}
	if connected {
		status = "connected"
	} else if creds != nil {
		status = "idle"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"connected": connected,
		"bot_id":    botID,
		"status":    status,
	})
}

func handleReconnect(w http.ResponseWriter, _ *http.Request) {
	creds, err := loadCredentials(globalDataDir)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no credentials found"})
		return
	}

	setCredentials(creds)
	stopMonitor()
	go startMonitor(creds)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bot_id": creds.BotID})
}

func handleUnbind(w http.ResponseWriter, _ *http.Request) {
	stopMonitor()
	setCredentials(nil)
	if err := deleteCredentials(globalDataDir); err != nil {
		slog.Error("delete credentials failed", "error", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writePortFile(dataDir string, port int) {
	p := filepath.Join(dataDir, "wechat_sidecar.port")
	if err := os.WriteFile(p, []byte(fmt.Sprintf("%d", port)), 0644); err != nil {
		slog.Error("write port file failed", "error", err)
	}
}

func removePortFile(dataDir string) {
	p := filepath.Join(dataDir, "wechat_sidecar.port")
	_ = os.Remove(p)
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".agenticx"
	}
	return filepath.Join(home, ".agenticx")
}
