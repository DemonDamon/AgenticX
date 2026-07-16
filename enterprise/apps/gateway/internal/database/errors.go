package database

import "errors"

var (
	ErrUnsupportedDialect = errors.New("unsupported database dialect")
	ErrMissingURL         = errors.New("DATABASE_URL is required")
	ErrInvalidConfig      = errors.New("invalid database configuration")
	ErrUnclosedSQLToken   = errors.New("unclosed SQL string or comment")
)
