package audit

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// PgInserter persists a finalized event to PostgreSQL.
type PgInserter interface {
	Insert(ctx context.Context, e Event) error
}

// DualWriter always appends to JSONL first; PostgreSQL insert is best-effort async.
type DualWriter struct {
	file   *FileWriter
	pg     PgInserter
	dir    string
	logger *slog.Logger
	wg     sync.WaitGroup // optional: tests / graceful shutdown
}

// NewDualWriter wraps a file writer. pg may be nil (file_only).
func NewDualWriter(file *FileWriter, pg PgInserter, dir string, logger *slog.Logger) *DualWriter {
	if logger == nil {
		logger = slog.Default()
	}
	return &DualWriter{file: file, pg: pg, dir: dir, logger: logger}
}

func (d *DualWriter) Write(ev *Event) error {
	if d == nil || d.file == nil {
		return errors.New("dual writer: nil file writer")
	}
	if err := d.file.Write(ev); err != nil {
		return err
	}
	if d.pg == nil {
		return nil
	}
	payload := *ev
	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := d.pg.Insert(ctx, payload); err != nil {
			d.logger.Warn("audit pg insert failed", "error", err, "id", payload.ID, "tenant_id", payload.TenantID)
			if perr := appendPgPending(d.dir, payload.ID, err.Error()); perr != nil {
				d.logger.Warn("audit pending log failed", "error", perr)
			}
		}
	}()
	return nil
}

// Wait flushes async PG inserts (for tests).
func (d *DualWriter) Wait() {
	if d == nil {
		return
	}
	d.wg.Wait()
}
