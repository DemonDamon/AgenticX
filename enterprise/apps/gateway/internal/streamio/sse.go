// Package streamio provides bounded, context-aware reads shared by stream transports.
package streamio

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

var (
	ErrIdleTimeout    = errors.New("stream:idle_timeout")
	ErrBufferExceeded = errors.New("stream:buffer_exceeded")
)

type Config struct {
	IdleTimeout       time.Duration
	HeaderTimeout     time.Duration
	ScannerMaxBufferB int64
}

func ConfigFromEnv() Config {
	cfg := Config{IdleTimeout: 180 * time.Second, ScannerMaxBufferB: 16 * 1024 * 1024}
	const maxSeconds = int64((1<<63 - 1) / time.Second)
	if n, err := strconv.ParseInt(strings.TrimSpace(os.Getenv("GATEWAY_STREAM_IDLE_TIMEOUT")), 10, 64); err == nil && n > 0 && n <= maxSeconds {
		cfg.IdleTimeout = time.Duration(n) * time.Second
	}
	if n, err := strconv.ParseInt(strings.TrimSpace(os.Getenv("GATEWAY_STREAM_HEADER_TIMEOUT")), 10, 64); err == nil && n > 0 && n <= maxSeconds {
		cfg.HeaderTimeout = time.Duration(n) * time.Second
	}
	if n, err := strconv.ParseInt(strings.TrimSpace(os.Getenv("GATEWAY_STREAM_SCANNER_MAX_BUFFER_MB")), 10, 64); err == nil && n > 0 && n <= (1<<63-1)/(1024*1024) {
		cfg.ScannerMaxBufferB = n * 1024 * 1024
	}
	return cfg.normalized()
}

func (c Config) normalized() Config {
	if c.IdleTimeout <= 0 {
		c.IdleTimeout = 180 * time.Second
	}
	if c.HeaderTimeout <= 0 {
		c.HeaderTimeout = c.IdleTimeout
	}
	if c.ScannerMaxBufferB <= 0 {
		c.ScannerMaxBufferB = 16 * 1024 * 1024
	}
	return c
}

type Event struct{ Name, Data string }

// ReadSSE resets idle on actual bytes, rather than waiting for a newline. The
// fixed-size read pump has one outstanding batch and never builds an unbounded
// frame. Network bodies must support Close so a stalled read can be interrupted.
// The caller context owns the total deadline; heartbeats only reset body idle.
func ReadSSE(ctx context.Context, body io.Reader, cfg Config, emit func(Event) (bool, error)) error {
	cfg = cfg.normalized()
	readCtx, cancel := context.WithCancel(ctx)
	defer func() {
		cancel()
		if closer, ok := body.(io.Closer); ok {
			_ = closer.Close()
		}
	}()
	type batch struct {
		data      []byte
		err       error
		completed time.Time
	}
	reads := make(chan batch)
	ack := make(chan struct{})
	go func() {
		buffer := make([]byte, 4096)
		for {
			n, err := body.Read(buffer)
			select {
			case reads <- batch{buffer[:n], err, time.Now()}:
			case <-readCtx.Done():
				return
			}
			// Do not reuse buffer until the consumer has processed this batch.
			select {
			case <-ack:
			case <-readCtx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()

	var line []byte
	var event Event
	var dataLines []string
	var eventBytes, totalBytes int64
	flush := func() (bool, error) {
		if len(dataLines) == 0 {
			event = Event{}
			return false, nil
		}
		event.Data = strings.TrimSpace(strings.Join(dataLines, "\n"))
		totalBytes += int64(len(event.Data))
		if totalBytes > cfg.ScannerMaxBufferB {
			return false, ErrBufferExceeded
		}
		done, err := emit(event)
		event, dataLines, eventBytes = Event{}, nil, 0
		return done, err
	}
	consumeLine := func() (bool, error) {
		current := bytes.TrimSuffix(line, []byte("\r"))
		if len(current) == 0 {
			return flush()
		}
		if bytes.HasPrefix(current, []byte("event:")) {
			event.Name = strings.TrimSpace(string(current[len("event:"):]))
		} else if bytes.HasPrefix(current, []byte("data:")) {
			// Count the wire line, including padding, before trimming. Retained
			// substrings must not keep an arbitrarily padded backing string alive.
			eventBytes += int64(len(current)) + 1
			if eventBytes > cfg.ScannerMaxBufferB {
				return false, ErrBufferExceeded
			}
			data := strings.Clone(strings.TrimSpace(string(current[len("data:"):])))
			dataLines = append(dataLines, data)
		}
		return false, nil
	}
	timer := time.NewTimer(cfg.IdleTimeout)
	defer timer.Stop()
	remaining := cfg.IdleTimeout
	waitStarted := time.Now()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return ErrIdleTimeout
		case res := <-reads:
			if err := ctx.Err(); err != nil {
				return err
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			if res.completed.After(waitStarted.Add(remaining)) {
				return ErrIdleTimeout
			}
			if len(res.data) > 0 {
				remaining = cfg.IdleTimeout
			} else {
				remaining -= time.Since(waitStarted)
			}
			for len(res.data) > 0 {
				if err := ctx.Err(); err != nil {
					return err
				}
				idx := bytes.IndexByte(res.data, '\n')
				n := len(res.data)
				if idx >= 0 {
					n = idx
				}
				if int64(len(line))+int64(n) > cfg.ScannerMaxBufferB {
					return ErrBufferExceeded
				}
				line = append(line, res.data[:n]...)
				res.data = res.data[n:]
				if idx < 0 {
					break
				}
				res.data = res.data[1:]
				done, err := consumeLine()
				line = line[:0]
				if err != nil || done {
					return err
				}
			}
			select {
			case ack <- struct{}{}:
			case <-ctx.Done():
				return ctx.Err()
			}
			if res.err != nil {
				if err := ctx.Err(); err != nil {
					return err
				}
				if res.err != io.EOF {
					return res.err
				}
				if len(line) > 0 {
					if done, err := consumeLine(); err != nil || done {
						return err
					}
				}
				_, err := flush()
				return err
			}
			// Downstream processing/backpressure is not upstream read idleness.
			// Zero-byte reads retain the remaining budget instead of renewing it.
			if remaining <= 0 {
				return ErrIdleTimeout
			}
			waitStarted = time.Now()
			timer.Reset(remaining)
		}
	}
}
