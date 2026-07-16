package database

import (
	"fmt"
	"strings"
)

// Dialect identifies the SQL dialect used by the gateway persistence layer.
type Dialect string

const (
	PostgreSQL Dialect = "postgresql"
	MySQL      Dialect = "mysql"
)

func ParseDialect(raw string) (Dialect, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "postgres", "postgresql":
		return PostgreSQL, nil
	case "mysql":
		return MySQL, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrUnsupportedDialect, strings.TrimSpace(raw))
	}
}

func (d Dialect) Valid() bool {
	return d == PostgreSQL || d == MySQL
}
