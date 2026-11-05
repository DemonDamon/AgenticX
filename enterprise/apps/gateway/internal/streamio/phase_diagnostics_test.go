package streamio

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/observability"
)

func TestPhaseEvidenceSeparatesHeadersBytesAndCompleteFrames(t *testing.T) {
	byteRelease, frameRelease := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		select {
		case <-byteRelease:
		case <-r.Context().Done():
			return
		}
		_, _ = io.WriteString(w, "data: ")
		w.(http.Flusher).Flush()
		select {
		case <-frameRelease:
		case <-r.Context().Done():
			return
		}
		_, _ = io.WriteString(w, "payload\n\n")
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ctx, phases := observability.NewPhaseSampler(1, nil, nil).Start(ctx)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	resp, err := DoStream(server.Client(), req, Config{HeaderTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	initial := phases.Snapshot()
	if initial.UpstreamStartMS < 0 || initial.ResponseHeadersMS < initial.UpstreamStartMS || initial.FirstBodyByteMS != -1 {
		t.Fatalf("initial=%+v", initial)
	}
	frames := make(chan string, 1)
	result := make(chan error, 1)
	go func() {
		result <- ReadSSE(ctx, resp.Body, Config{IdleTimeout: time.Second}, func(event Event) (bool, error) { frames <- event.Data; return true, nil })
	}()
	close(byteRelease)
	for phases.Snapshot().FirstBodyByteMS < 0 {
		select {
		case <-ctx.Done():
			t.Fatal("first byte was not recorded")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	select {
	case frame := <-frames:
		t.Fatalf("partial frame emitted: %q", frame)
	default:
	}
	close(frameRelease)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if frame := <-frames; frame != "payload" {
		t.Fatalf("frame=%q", frame)
	}
	final := phases.Snapshot()
	if final.FirstBodyByteMS < final.ResponseHeadersMS || final.FirstContentMS != -1 {
		t.Fatalf("final=%+v", final)
	}
	// Retries/subsequent transport calls cannot replace the initial milestone.
	phases.MarkAt(observability.ResponseHeaders, time.Now().Add(time.Hour))
	if phases.Snapshot().ResponseHeadersMS != final.ResponseHeadersMS {
		t.Fatal("header milestone overwritten")
	}
}
