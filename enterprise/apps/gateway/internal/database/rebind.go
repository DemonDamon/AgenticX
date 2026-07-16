package database

import (
	"fmt"
	"strconv"
	"strings"
)

// Rebind rewrites ordinary ? placeholders for PostgreSQL while preserving
// question marks inside SQL strings, identifiers, and comments.
func Rebind(dialect Dialect, query string) (string, error) {
	if dialect == MySQL {
		return query, nil
	}
	if dialect != PostgreSQL {
		return "", fmt.Errorf("%w: %q", ErrUnsupportedDialect, dialect)
	}

	const (
		stateSQL = iota
		stateSingleQuote
		stateDoubleQuote
		stateBacktick
		stateLineComment
		stateBlockComment
	)

	var out strings.Builder
	out.Grow(len(query) + 8)
	state := stateSQL
	placeholder := 0

	for i := 0; i < len(query); i++ {
		ch := query[i]
		next := byte(0)
		if i+1 < len(query) {
			next = query[i+1]
		}

		switch state {
		case stateSQL:
			switch {
			case ch == '\'':
				state = stateSingleQuote
				out.WriteByte(ch)
			case ch == '"':
				state = stateDoubleQuote
				out.WriteByte(ch)
			case ch == '`':
				state = stateBacktick
				out.WriteByte(ch)
			case ch == '-' && next == '-':
				state = stateLineComment
				out.WriteString("--")
				i++
			case ch == '/' && next == '*':
				state = stateBlockComment
				out.WriteString("/*")
				i++
			case ch == '?':
				placeholder++
				out.WriteByte('$')
				out.WriteString(strconv.Itoa(placeholder))
			default:
				out.WriteByte(ch)
			}
		case stateSingleQuote:
			out.WriteByte(ch)
			if ch == '\'' {
				if next == '\'' {
					out.WriteByte(next)
					i++
				} else {
					state = stateSQL
				}
			}
		case stateDoubleQuote:
			out.WriteByte(ch)
			if ch == '"' {
				if next == '"' {
					out.WriteByte(next)
					i++
				} else {
					state = stateSQL
				}
			}
		case stateBacktick:
			out.WriteByte(ch)
			if ch == '`' {
				if next == '`' {
					out.WriteByte(next)
					i++
				} else {
					state = stateSQL
				}
			}
		case stateLineComment:
			out.WriteByte(ch)
			if ch == '\n' {
				state = stateSQL
			}
		case stateBlockComment:
			out.WriteByte(ch)
			if ch == '*' && next == '/' {
				out.WriteByte(next)
				i++
				state = stateSQL
			}
		}
	}

	if state != stateSQL && state != stateLineComment {
		return "", fmt.Errorf("%w", ErrUnclosedSQLToken)
	}
	return out.String(), nil
}
