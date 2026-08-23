package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsMissingRelationRecognizesUnmigratedSchema(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"pg undefined_table", &pgconn.PgError{Code: "42P01"}},
		{"pg undefined_column", &pgconn.PgError{Code: "42703"}},
		{"mysql no such table", &mysqlDriver.MySQLError{Number: 1146}},
		{"mysql bad field", &mysqlDriver.MySQLError{Number: 1054}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if !IsMissingRelation(tc.err) {
				t.Fatalf("IsMissingRelation(%v) = false, want true", tc.err)
			}
			// 调用方一路 %w 包上来，包了还得认得出。
			if !IsMissingRelation(fmt.Errorf("governed lookup: %w", tc.err)) {
				t.Fatal("wrapped error must still be recognized")
			}
		})
	}
}

func TestIsMissingRelationRejectsTransientFailures(t *testing.T) {
	// 这些都表示表还在，只是这一刻够不到——放行就等于「把库弄挂即可绕过撤销」。
	cases := []struct {
		name string
		err  error
	}{
		{"nil", nil},
		{"connection refused", errors.New("dial tcp 127.0.0.1:5432: connect: connection refused")},
		{"context deadline", context.DeadlineExceeded},
		{"driver closed", sql.ErrConnDone},
		{"pg deadlock", &pgconn.PgError{Code: "40P01"}},
		{"pg insufficient privilege", &pgconn.PgError{Code: "42501"}},
		{"mysql access denied", &mysqlDriver.MySQLError{Number: 1045}},
		{"mysql lock wait timeout", &mysqlDriver.MySQLError{Number: 1205}},
		{"text mentioning no such table", errors.New("no such table: enterprise_capability_packs")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if IsMissingRelation(tc.err) {
				t.Fatalf("IsMissingRelation(%v) = true, want false", tc.err)
			}
		})
	}
}
