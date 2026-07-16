module github.com/agenticx/enterprise/gateway

go 1.25.0

require (
	github.com/agenticx/enterprise/policy-engine v0.0.0
	github.com/alicebob/miniredis/v2 v2.35.0
	github.com/fsnotify/fsnotify v1.9.0
	github.com/go-chi/chi/v5 v5.2.3
	github.com/go-sql-driver/mysql v1.10.0
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/jackc/pgx/v5 v5.10.0
	github.com/prometheus/client_golang v1.23.2
	github.com/redis/go-redis/v9 v9.19.0
	github.com/tetratelabs/wazero v1.9.0
	golang.org/x/crypto v0.43.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	filippo.io/edwards25519 v1.2.0 // indirect
	github.com/beorn7/perks v1.0.1 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/munnerz/goautoneg v0.0.0-20191010083416-a7dc8b61c822 // indirect
	github.com/prometheus/client_model v0.6.2 // indirect
	github.com/prometheus/common v0.66.1 // indirect
	github.com/prometheus/procfs v0.16.1 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/yuin/gopher-lua v1.1.1 // indirect
	go.uber.org/atomic v1.11.0 // indirect
	go.yaml.in/yaml/v2 v2.4.2 // indirect
	golang.org/x/sync v0.17.0 // indirect
	golang.org/x/sys v0.37.0 // indirect
	golang.org/x/text v0.30.0 // indirect
	google.golang.org/protobuf v1.36.8 // indirect
)

replace github.com/agenticx/enterprise/policy-engine => ../../packages/policy-engine
