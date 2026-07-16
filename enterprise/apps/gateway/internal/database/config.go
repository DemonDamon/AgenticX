package database

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

type Config struct {
	Dialect     Dialect
	DriverName  string
	DSN         string
	RedactedDSN string
}

func OpenFromEnv() (*Handle, error) {
	cfg, err := ParseConfig(os.Getenv("DATABASE_DIALECT"), os.Getenv("DATABASE_URL"))
	if err != nil {
		return nil, err
	}
	return Open(cfg)
}

func ParseConfig(rawDialect, rawURL string) (Config, error) {
	dialect, err := ParseDialect(rawDialect)
	if err != nil {
		return Config{}, err
	}
	connectionString := strings.TrimSpace(rawURL)
	if connectionString == "" {
		return Config{}, ErrMissingURL
	}

	switch dialect {
	case PostgreSQL:
		dsn := ensurePostgresSSLMode(connectionString)
		return Config{
			Dialect:     PostgreSQL,
			DriverName:  "pgx",
			DSN:         dsn,
			RedactedDSN: redactURL(dsn),
		}, nil
	case MySQL:
		return parseMySQLConfig(connectionString)
	default:
		return Config{}, fmt.Errorf("%w: %q", ErrUnsupportedDialect, dialect)
	}
}

func parseMySQLConfig(connectionString string) (Config, error) {
	dsn := connectionString
	if strings.HasPrefix(strings.ToLower(connectionString), "mysql://") {
		parsedURL, err := url.Parse(connectionString)
		if err != nil || parsedURL.Host == "" {
			return Config{}, fmt.Errorf("%w: malformed mysql URL", ErrInvalidConfig)
		}
		cfg := mysqlDriver.NewConfig()
		cfg.User = parsedURL.User.Username()
		cfg.Passwd, _ = parsedURL.User.Password()
		cfg.Net = "tcp"
		cfg.Addr = parsedURL.Host
		cfg.DBName = strings.TrimPrefix(parsedURL.EscapedPath(), "/")
		if decoded, err := url.PathUnescape(cfg.DBName); err == nil {
			cfg.DBName = decoded
		}
		dsn = cfg.FormatDSN()
		if parsedURL.RawQuery != "" {
			dsn += "?" + parsedURL.RawQuery
		}
	}

	cfg, err := mysqlDriver.ParseDSN(dsn)
	if err != nil {
		return Config{}, fmt.Errorf("%w: malformed mysql DSN", ErrInvalidConfig)
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	if cfg.Params == nil {
		cfg.Params = make(map[string]string)
	}
	cfg.Params["charset"] = "utf8mb4"
	cfg.Params["time_zone"] = "'+00:00'"

	redacted := *cfg
	redacted.Passwd = "xxxxx"
	return Config{
		Dialect:     MySQL,
		DriverName:  "mysql",
		DSN:         cfg.FormatDSN(),
		RedactedDSN: redacted.FormatDSN(),
	}, nil
}

func redactURL(connectionString string) string {
	parsed, err := url.Parse(connectionString)
	if err != nil || parsed.User == nil {
		return "database://xxxxx"
	}
	if _, hasPassword := parsed.User.Password(); hasPassword {
		parsed.User = url.UserPassword(parsed.User.Username(), "xxxxx")
	}
	return parsed.String()
}

func ensurePostgresSSLMode(connectionString string) string {
	trimmed := strings.TrimSpace(connectionString)
	if trimmed == "" {
		return trimmed
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "postgres://") || strings.HasPrefix(lower, "postgresql://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return trimmed
		}
		query := parsed.Query()
		if query.Get("sslmode") != "" {
			return trimmed
		}
		query.Set("sslmode", "disable")
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	if strings.Contains(lower, "sslmode=") {
		return trimmed
	}
	if strings.HasSuffix(trimmed, " ") {
		return trimmed + "sslmode=disable"
	}
	return trimmed + " sslmode=disable"
}
