package database

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type Handle struct {
	Dialect Dialect
	DB      *sql.DB
}

func Open(cfg Config) (*Handle, error) {
	if !cfg.Dialect.Valid() || cfg.DriverName == "" || cfg.DSN == "" {
		return nil, ErrInvalidConfig
	}
	db, err := sql.Open(cfg.DriverName, cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("open %s database (%s): %w", cfg.Dialect, cfg.RedactedDSN, err)
	}
	return &Handle{Dialect: cfg.Dialect, DB: db}, nil
}

func (h *Handle) Ping(ctx context.Context) error {
	if h == nil || h.DB == nil {
		return fmt.Errorf("database handle unavailable")
	}
	if err := h.DB.PingContext(ctx); err != nil {
		return fmt.Errorf("ping %s database: %w", h.Dialect, err)
	}
	return nil
}

func (h *Handle) Close() error {
	if h == nil || h.DB == nil {
		return nil
	}
	return h.DB.Close()
}

func (h *Handle) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	if h == nil || h.DB == nil {
		return nil, fmt.Errorf("database handle unavailable")
	}
	bound, err := Rebind(h.Dialect, query)
	if err != nil {
		return nil, err
	}
	return h.DB.ExecContext(ctx, bound, args...)
}

func (h *Handle) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	if h == nil || h.DB == nil {
		return nil, fmt.Errorf("database handle unavailable")
	}
	bound, err := Rebind(h.Dialect, query)
	if err != nil {
		return nil, err
	}
	return h.DB.QueryContext(ctx, bound, args...)
}

func (h *Handle) QueryRowContext(ctx context.Context, query string, args ...any) (*sql.Row, error) {
	if h == nil || h.DB == nil {
		return nil, fmt.Errorf("database handle unavailable")
	}
	bound, err := Rebind(h.Dialect, query)
	if err != nil {
		return nil, err
	}
	return h.DB.QueryRowContext(ctx, bound, args...), nil
}
