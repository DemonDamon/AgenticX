package streamio

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

var ErrHeaderTimeout = errors.New("stream:header_timeout")

type cancelBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelBody) Close() error { b.cancel(); return b.ReadCloser.Close() }

// DoStream bounds response-header waiting independently of body idle. A cloned
// client has no whole-stream timeout: the caller context retains that authority.
func DoStream(client *http.Client, req *http.Request, cfg Config) (*http.Response, error) {
	cfg = cfg.normalized()
	ctx, cancel := context.WithCancel(req.Context())
	var mu sync.Mutex
	var returned, expired bool
	timer := time.AfterFunc(cfg.HeaderTimeout, func() {
		mu.Lock()
		defer mu.Unlock()
		if !returned {
			expired = true
			cancel()
		}
	})
	streamClient := *client
	streamClient.Timeout = 0
	resp, err := streamClient.Do(req.WithContext(ctx))
	mu.Lock()
	returned = true
	timedOut := expired
	mu.Unlock()
	timer.Stop()
	if timedOut {
		cancel()
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if req.Context().Err() != nil {
			return nil, req.Context().Err()
		}
		return nil, ErrHeaderTimeout
	}
	if err != nil {
		cancel()
		return nil, err
	}
	resp.Body = &cancelBody{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}
