package database

import "testing"

func TestRebindPostgreSQLReplacesOnlySQLPlaceholders(t *testing.T) {
	t.Parallel()

	query := "SELECT ?, '?', \"?\", `?`, data->'$.items[?]' FROM t -- ?\nWHERE a = ? /* ? */ AND b = ?"
	got, err := Rebind(PostgreSQL, query)
	if err != nil {
		t.Fatalf("Rebind() error = %v", err)
	}
	want := "SELECT $1, '?', \"?\", `?`, data->'$.items[?]' FROM t -- ?\nWHERE a = $2 /* ? */ AND b = $3"
	if got != want {
		t.Fatalf("Rebind() = %q, want %q", got, want)
	}
}

func TestRebindMySQLLeavesQueryUnchanged(t *testing.T) {
	t.Parallel()

	query := "SELECT ? FROM t WHERE value = '?'"
	got, err := Rebind(MySQL, query)
	if err != nil {
		t.Fatalf("Rebind() error = %v", err)
	}
	if got != query {
		t.Fatalf("Rebind() = %q, want unchanged query", got)
	}
}

func TestRebindHandlesEscapedQuotes(t *testing.T) {
	t.Parallel()

	query := `SELECT 'it''s ?', "a""?b", ` + "`a``?b`" + `, ?`
	got, err := Rebind(PostgreSQL, query)
	if err != nil {
		t.Fatalf("Rebind() error = %v", err)
	}
	want := `SELECT 'it''s ?', "a""?b", ` + "`a``?b`" + `, $1`
	if got != want {
		t.Fatalf("Rebind() = %q, want %q", got, want)
	}
}

func TestRebindRejectsUnclosedLexicalConstructs(t *testing.T) {
	t.Parallel()

	tests := []string{
		"SELECT 'unterminated ?",
		`SELECT "unterminated ?`,
		"SELECT `unterminated ?",
		"SELECT 1 /* unterminated ?",
	}
	for _, query := range tests {
		query := query
		t.Run(query, func(t *testing.T) {
			t.Parallel()
			if _, err := Rebind(PostgreSQL, query); err == nil {
				t.Fatal("Rebind() error = nil, want lexical error")
			}
		})
	}
}

func TestRebindAllowsLineCommentAtEOF(t *testing.T) {
	t.Parallel()

	query := "SELECT ? -- trailing ?"
	got, err := Rebind(PostgreSQL, query)
	if err != nil {
		t.Fatalf("Rebind() error = %v", err)
	}
	if got != "SELECT $1 -- trailing ?" {
		t.Fatalf("Rebind() = %q", got)
	}
}
