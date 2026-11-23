package virtualmodel

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestReloadKeepsSnapshotOnParseError(t *testing.T) {
	var hits atomic.Int32
	good := []byte(`{"virtualModels":[{"tenantId":"t1","name":"virt","displayName":"V","enabled":true,"targets":[{"model":"real-a","weight":1,"priority":0}]}]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) == 1 {
			_, _ = w.Write(good)
			return
		}
		_, _ = w.Write([]byte(`{`))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_REMOTE_VIRTUAL_MODELS_URL", srv.URL)
	l := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := l.reload(); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := l.Plan("t1", "virt", func(string) bool { return true }); !ok {
		t.Fatal("expected virtual model after good snapshot")
	}
	if err := l.reload(); err == nil {
		t.Fatal("expected parse error")
	}
	if _, _, ok := l.Plan("t1", "virt", func(string) bool { return true }); !ok {
		t.Fatal("parse error cleared the last snapshot")
	}
}

func TestReloadKeepsSnapshotOnRemote404(t *testing.T) {
	var hits atomic.Int32
	good := []byte(`{"virtualModels":[{"tenantId":"t1","name":"virt","displayName":"V","enabled":true,"targets":[{"model":"real-a","weight":1,"priority":0}]}]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) == 1 {
			_, _ = w.Write(good)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_REMOTE_VIRTUAL_MODELS_URL", srv.URL)
	l := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := l.reload(); err != nil {
		t.Fatal(err)
	}
	err := l.reload()
	if err == nil || !strings.Contains(err.Error(), "remote 404") {
		t.Fatalf("reload err = %v", err)
	}
	if _, _, ok := l.Plan("t1", "virt", func(string) bool { return true }); !ok {
		t.Fatal("remote 404 cleared the last snapshot")
	}
}
