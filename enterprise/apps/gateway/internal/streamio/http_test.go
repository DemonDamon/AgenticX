package streamio

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestResponseHeaderTimeoutIsDistinct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	_, err := DoStream(server.Client(), req, Config{HeaderTimeout: 40 * time.Millisecond, IdleTimeout: time.Second})
	if !errors.Is(err, ErrHeaderTimeout) {
		t.Fatalf("got %v", err)
	}
}

func TestBodyIdleStartsAfterHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
	cfg := Config{HeaderTimeout: time.Second, IdleTimeout: 40 * time.Millisecond}
	resp, err := DoStream(server.Client(), req, cfg)
	if err != nil {
		t.Fatal(err)
	}
	err = ReadSSE(req.Context(), resp.Body, cfg, func(Event) (bool, error) { return false, nil })
	if !errors.Is(err, ErrIdleTimeout) {
		t.Fatalf("got %v", err)
	}
}

func TestRequestCancellationAfterHeaders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	resp, err := DoStream(server.Client(), req, Config{})
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	err = ReadSSE(ctx, resp.Body, Config{}, func(Event) (bool, error) { return false, nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
}
