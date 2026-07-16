package database

import (
	"strings"
	"testing"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

func TestParseConfigPostgreSQL(t *testing.T) {
	t.Parallel()

	cfg, err := ParseConfig("postgresql", "postgres://alice:secret@db.example:5432/app?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseConfig() error = %v", err)
	}
	if cfg.Dialect != PostgreSQL || cfg.DriverName != "pgx" {
		t.Fatalf("ParseConfig() = %#v", cfg)
	}
	if strings.Contains(cfg.RedactedDSN, "secret") || !strings.Contains(cfg.RedactedDSN, "xxxxx") {
		t.Fatalf("RedactedDSN = %q", cfg.RedactedDSN)
	}
}

func TestParseConfigMySQLURLForcesSessionSettings(t *testing.T) {
	t.Parallel()

	cfg, err := ParseConfig("mysql", "mysql://alice:secret@db.example:3306/app?parseTime=false&loc=Local&charset=latin1")
	if err != nil {
		t.Fatalf("ParseConfig() error = %v", err)
	}
	if cfg.Dialect != MySQL || cfg.DriverName != "mysql" {
		t.Fatalf("ParseConfig() = %#v", cfg)
	}
	parsed, err := mysqlDriver.ParseDSN(cfg.DSN)
	if err != nil {
		t.Fatalf("mysql.ParseDSN() error = %v", err)
	}
	if !parsed.ParseTime || parsed.Loc.String() != "UTC" || !strings.Contains(cfg.DSN, "charset=utf8mb4") {
		t.Fatalf("forced settings missing: %#v", parsed)
	}
	if parsed.Params["time_zone"] != "'+00:00'" {
		t.Fatalf("time_zone = %q, want %q", parsed.Params["time_zone"], "'+00:00'")
	}
	if strings.Contains(cfg.RedactedDSN, "secret") {
		t.Fatalf("RedactedDSN leaked password: %q", cfg.RedactedDSN)
	}
}

func TestParseConfigMySQLNativeDSNForcesSessionSettings(t *testing.T) {
	t.Parallel()

	cfg, err := ParseConfig("mysql", "alice:secret@tcp(localhost:3306)/app")
	if err != nil {
		t.Fatalf("ParseConfig() error = %v", err)
	}
	parsed, err := mysqlDriver.ParseDSN(cfg.DSN)
	if err != nil {
		t.Fatalf("mysql.ParseDSN() error = %v", err)
	}
	if !parsed.ParseTime || parsed.Loc.String() != "UTC" || !strings.Contains(cfg.DSN, "charset=utf8mb4") {
		t.Fatalf("forced settings missing: %#v", parsed)
	}
}

func TestParseConfigRejectsUnsupportedDialectWithoutLeakingCredentials(t *testing.T) {
	t.Parallel()

	_, err := ParseConfig("sqlite", "sqlite://alice:secret@example/app")
	if err == nil {
		t.Fatal("ParseConfig() error = nil")
	}
	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("error leaked credentials: %v", err)
	}
}

func TestParseConfigRejectsInvalidMySQLURLWithoutLeakingCredentials(t *testing.T) {
	t.Parallel()

	_, err := ParseConfig("mysql", "mysql://alice:secret@%zz")
	if err == nil {
		t.Fatal("ParseConfig() error = nil")
	}
	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("error leaked credentials: %v", err)
	}
}
