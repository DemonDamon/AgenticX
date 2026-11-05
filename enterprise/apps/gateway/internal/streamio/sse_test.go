package streamio

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestFragmentBytesResetIdleBeforeNewline(t *testing.T) {
	r, w := io.Pipe()
	defer w.Close()
	go func() {
		defer w.Close()
		for _, b := range []byte("data: fragmented-payload\n\n") {
			if _, err := w.Write([]byte{b}); err != nil {
				return
			}
			time.Sleep(15 * time.Millisecond)
		}
	}()
	start := time.Now()
	var got string
	err := ReadSSE(context.Background(), r, Config{IdleTimeout: 150 * time.Millisecond}, func(e Event) (bool, error) { got = e.Data; return true, nil })
	if err != nil || got != "fragmented-payload" {
		t.Fatalf("data=%q err=%v", got, err)
	}
	if time.Since(start) <= 150*time.Millisecond {
		t.Fatal("fixture must span more than one idle interval")
	}
}

func TestIdleAndBounds(t *testing.T) {
	t.Run("stalled body", func(t *testing.T) {
		r, w := io.Pipe()
		defer w.Close()
		err := ReadSSE(context.Background(), r, Config{IdleTimeout: 40 * time.Millisecond}, func(Event) (bool, error) { return false, nil })
		if !errors.Is(err, ErrIdleTimeout) {
			t.Fatalf("got %v", err)
		}
		if _, err := w.Write([]byte("late")); err == nil {
			t.Fatal("timeout did not close body")
		}
	})
	for name, data := range map[string]string{
		"no newline":        "data: " + strings.Repeat("x", 100),
		"multiline event":   "data: " + strings.Repeat("x", 40) + "\ndata: " + strings.Repeat("y", 40) + "\n\n",
		"cumulative budget": strings.Repeat("data: "+strings.Repeat("x", 25)+"\n\n", 4),
	} {
		t.Run(name, func(t *testing.T) {
			err := ReadSSE(context.Background(), strings.NewReader(data), Config{ScannerMaxBufferB: 64}, func(Event) (bool, error) { return false, nil })
			if !errors.Is(err, ErrBufferExceeded) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

type zeroByteBody struct{ closed atomic.Bool }

func (b *zeroByteBody) Read([]byte) (int, error) {
	time.Sleep(time.Millisecond)
	if b.closed.Load() {
		return 0, io.EOF
	}
	return 0, nil
}
func (b *zeroByteBody) Close() error { b.closed.Store(true); return nil }

func TestZeroByteReadsDoNotResetIdle(t *testing.T) {
	body := &zeroByteBody{}
	err := ReadSSE(context.Background(), body, Config{IdleTimeout: 30 * time.Millisecond}, func(Event) (bool, error) { return false, nil })
	if !errors.Is(err, ErrIdleTimeout) || !body.closed.Load() {
		t.Fatalf("err=%v closed=%v", err, body.closed.Load())
	}
}

func TestTotalDeadlineWinsOverHeartbeatTraffic(t *testing.T) {
	r, w := io.Pipe()
	defer w.Close()
	go func() {
		defer w.Close()
		for {
			if _, err := io.WriteString(w, ": heartbeat\n\n"); err != nil {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := ReadSSE(ctx, r, Config{IdleTimeout: time.Second}, func(Event) (bool, error) { return false, nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
}

func TestCRLFAndFinalEventWithoutBlankLine(t *testing.T) {
	var events []Event
	err := ReadSSE(context.Background(), strings.NewReader("event: update\r\ndata: one\r\ndata: two"), Config{}, func(e Event) (bool, error) { events = append(events, e); return false, nil })
	if err != nil || len(events) != 1 || events[0].Name != "update" || events[0].Data != "one\ntwo" {
		t.Fatalf("events=%+v err=%v", events, err)
	}
}

type callbackDelayReader struct {
	chunks []string
	index  int
}

func (r *callbackDelayReader) Read(dst []byte) (int, error) {
	if r.index >= len(r.chunks) {
		return 0, io.EOF
	}
	if r.index > 0 {
		// Keep every actual read well below the upstream idle threshold.
		time.Sleep(time.Millisecond)
	}
	n := copy(dst, r.chunks[r.index])
	r.index++
	return n, nil
}

func TestSlowCallbackDoesNotConsumeUpstreamIdleBudget(t *testing.T) {
	body := &callbackDelayReader{chunks: []string{"data: first\n\n", "data: final\n\n"}}
	var events []string
	err := ReadSSE(context.Background(), body, Config{IdleTimeout: 40 * time.Millisecond}, func(event Event) (bool, error) {
		events = append(events, event.Data)
		if event.Data == "first" {
			// The reader is deliberately paused for downstream backpressure.
			time.Sleep(100 * time.Millisecond)
		}
		return event.Data == "final", nil
	})
	if err != nil || strings.Join(events, ",") != "first,final" {
		t.Fatalf("read latency <=1ms, events=%v err=%v", events, err)
	}
}

func TestPaddedDataLinesCannotBypassEventBudget(t *testing.T) {
	const maxBytes = 64 * 1024
	line := "data: x" + strings.Repeat(" ", 40*1024) + "\n"
	// Each line fits independently, but their retained event exceeds the cap.
	// Counting only the trimmed 'x' would retain both padded backing strings.
	body := strings.NewReader(line + line + "\n")
	emitted := false
	err := ReadSSE(context.Background(), body, Config{ScannerMaxBufferB: maxBytes}, func(Event) (bool, error) {
		emitted = true
		return false, nil
	})
	if !errors.Is(err, ErrBufferExceeded) || emitted {
		t.Fatalf("oversized padded event emitted=%v err=%v", emitted, err)
	}
}
