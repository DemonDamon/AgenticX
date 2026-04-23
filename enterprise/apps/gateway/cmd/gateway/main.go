package main

import (
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	srv, err := server.New(cfg, logger)
	if err != nil {
		log.Fatalf("init server failed: %v", err)
	}
	logger.Info("gateway starting", "addr", cfg.HTTPAddr)
	if err := http.ListenAndServe(cfg.HTTPAddr, srv.Router()); err != nil {
		log.Fatalf("gateway stopped: %v", err)
	}
}
