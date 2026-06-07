package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/agenticx/enterprise/edge-agent/internal/api"
	"github.com/agenticx/enterprise/edge-agent/internal/gateway"
	"github.com/agenticx/enterprise/edge-agent/internal/ingest"
	"github.com/agenticx/enterprise/edge-agent/internal/runner"
	"github.com/agenticx/enterprise/edge-agent/internal/sandbox"
	"github.com/agenticx/enterprise/edge-agent/internal/trace"
)

const Version = "0.2.0"

func main() {
	if !enabled() {
		fmt.Fprintln(os.Stderr, "edge-agent disabled (set EDGE_AGENT_ENABLED=1 to start)")
		os.Exit(0)
	}

	port := envInt("EDGE_AGENT_PORT", 7420)
	host := strings.TrimSpace(os.Getenv("EDGE_AGENT_HOST"))
	if host == "" {
		host = "127.0.0.1"
	}

	home := strings.TrimSpace(os.Getenv("AGX_HOME"))
	if home == "" {
		home = filepath.Join(os.Getenv("HOME"), ".agenticx")
	}
	tracePath := filepath.Join(home, "edge-agent", "traces.jsonl")
	store, err := trace.NewStore(tracePath)
	if err != nil {
		log.Fatalf("trace store: %v", err)
	}

	gw := gateway.NewClient(os.Getenv("EDGE_AGENT_GATEWAY_URL"), os.Getenv("EDGE_AGENT_GATEWAY_TOKEN"))
	sbCfg := sandbox.DefaultConfig()
	if ms := envInt("EDGE_AGENT_COMMAND_TIMEOUT_MS", 0); ms > 0 {
		sbCfg.CommandTimeout = time.Duration(ms) * time.Millisecond
	}
	run := runner.New(gw, store, sbCfg)
	if ingestURL := strings.TrimSpace(os.Getenv("EDGE_AGENT_TRACE_INGEST_URL")); ingestURL != "" {
		run.SetIngester(ingest.NewClient(ingestURL, os.Getenv("EDGE_AGENT_TRACE_INGEST_TOKEN")))
	}
	token := strings.TrimSpace(os.Getenv("EDGE_AGENT_TOKEN"))
	if token == "" {
		token = randomToken()
		tokenPath := filepath.Join(home, "edge.token")
		_ = os.MkdirAll(filepath.Dir(tokenPath), 0o700)
		if err := os.WriteFile(tokenPath, []byte(token), 0o600); err == nil {
			log.Printf("generated edge token at %s", tokenPath)
		}
	}

	srv := api.NewServer(run, store, token)
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	httpSrv := &http.Server{Addr: addr, Handler: srv.Handler()}
	log.Printf("AgenticX Edge Agent v%s listening on http://%s", Version, addr)
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func enabled() bool {
	v := strings.TrimSpace(os.Getenv("EDGE_AGENT_ENABLED"))
	return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

func randomToken() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return "agx-edge-" + hex.EncodeToString(buf)
}
