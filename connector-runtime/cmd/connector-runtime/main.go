// connector-runtime 命令行入口：serve（启动网关）/ call（MCP 工具调用）/ catalog（本地目录）/ version。
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/agenticx/connector-runtime/internal/connectors"
	mcppkg "github.com/agenticx/connector-runtime/internal/mcp"
	"github.com/agenticx/connector-runtime/internal/server"
)

var version = "0.1.0"

const defaultAddr = "127.0.0.1:41719"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		serveCmd(os.Args[2:])
	case "call":
		callCmd(os.Args[2:])
	case "catalog":
		catalogCmd(os.Args[2:])
	case "version", "--version", "-v":
		fmt.Println("connector-runtime " + version)
	case "help", "--help", "-h":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "未知命令: %s\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `connector-runtime — 本地连接器网关（MCP）

用法:
  connector-runtime serve    [flags]   启动网关（默认仅监听 127.0.0.1）
  connector-runtime call     <tool> [json参数] --url <mcp端点> --token <runtime token>
  connector-runtime catalog  [flags]   本地打印连接器目录
  connector-runtime version

serve 常用 flags:
  --data-dir <dir>            数据目录（密钥/连接/策略/审计，默认 ~/.connector-runtime）
  --addr <host:port>          监听地址（默认 127.0.0.1:41719）
  --runtime-token <token>     运行面 token（缺省自动生成并落盘 data-dir/runtime.token）
  --admin-token <token>       管理面 token（缺省自动生成并落盘 data-dir/admin.token）
  --connectors-dir <dir>      额外连接器定义目录（叠加在内置目录之上）
  --allow-private-network     允许私网/环回上游（本地调试/内网；默认拒绝）
  --dev-no-auth               跳过 token 认证（仅本地调试）
`)
}

func serveCmd(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dataDir := fs.String("data-dir", defaultDataDir(), "数据目录")
	addr := fs.String("addr", defaultAddr, "监听地址")
	runtimeToken := fs.String("runtime-token", "", "运行面 token")
	adminToken := fs.String("admin-token", "", "管理面 token")
	connectorsDir := fs.String("connectors-dir", "", "额外连接器定义目录")
	allowPrivate := fs.Bool("allow-private-network", false, "允许私网/环回上游")
	devNoAuth := fs.Bool("dev-no-auth", false, "跳过 token 认证（仅本地调试）")
	_ = fs.Parse(args)

	if err := os.MkdirAll(*dataDir, 0o700); err != nil {
		fatal(err)
	}
	conns, err := connectors.All(*connectorsDir)
	if err != nil {
		fatal(err)
	}
	mcppkg.Version = version

	rt := ensureToken(*dataDir, "runtime.token", *runtimeToken)
	at := ensureToken(*dataDir, "admin.token", *adminToken)

	s, err := server.New(server.Config{
		DataDir:             *dataDir,
		Connectors:          conns,
		RuntimeToken:        rt,
		AdminToken:          at,
		AllowPrivateNetwork: *allowPrivate,
		DevNoAuth:           *devNoAuth,
	})
	if err != nil {
		fatal(err)
	}

	httpSrv := &http.Server{Addr: *addr, Handler: s.Handler()}
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = httpSrv.Shutdown(ctx)
		cancel()
	}()

	fmt.Fprintf(os.Stderr, "connector-runtime %s 监听 %s（连接器 %d 个）\n", version, *addr, s.Catalog().Count())
	fmt.Fprintf(os.Stderr, "MCP 端点:   http://%s/mcp\n", *addr)
	if !*devNoAuth {
		fmt.Fprintf(os.Stderr, "runtime token: %s\n", rt)
		fmt.Fprintf(os.Stderr, "admin token:   %s\n", at)
	}
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fatal(err)
	}
	_ = s.Close()
}

func callCmd(args []string) {
	fs := flag.NewFlagSet("call", flag.ExitOnError)
	urlFlag := fs.String("url", "http://"+defaultAddr+"/mcp", "MCP 端点")
	token := fs.String("token", "", "runtime token")
	timeout := fs.Duration("timeout", 60*time.Second, "调用超时")
	_ = fs.Parse(args)
	rest := fs.Args()
	if len(rest) < 1 {
		fatal(fmt.Errorf("用法: connector-runtime call <tool> [json参数]"))
	}
	tool := rest[0]
	toolArgs := map[string]any{}
	if len(rest) > 1 {
		if err := json.Unmarshal([]byte(rest[1]), &toolArgs); err != nil {
			fatal(fmt.Errorf("JSON 参数解析失败: %w", err))
		}
	}

	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "tools/call",
		"params": map[string]any{"name": tool, "arguments": toolArgs},
	})
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", *urlFlag, bytes.NewReader(body))
	if err != nil {
		fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if *token != "" {
		req.Header.Set("Authorization", "Bearer "+*token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		fmt.Fprintf(os.Stderr, "HTTP %d\n", resp.StatusCode)
		fmt.Println(prettyJSON(raw))
		os.Exit(1)
	}
	// 提取 content[0].text 展示（保持原始 JSON 结构）
	var out struct {
		Result struct {
			Content []struct {
				Text string `json:"text"`
			} `json:"content"`
			IsError bool `json:"isError"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.Error != nil {
		fmt.Println(prettyJSON(raw))
		return
	}
	if len(out.Result.Content) > 0 {
		text := out.Result.Content[0].Text
		var buf bytes.Buffer
		if json.Indent(&buf, []byte(text), "", "  ") == nil {
			fmt.Println(buf.String())
		} else {
			fmt.Println(text)
		}
		if out.Result.IsError {
			os.Exit(1)
		}
		return
	}
	fmt.Println(prettyJSON(raw))
}

func catalogCmd(args []string) {
	fs := flag.NewFlagSet("catalog", flag.ExitOnError)
	connectorsDir := fs.String("connectors-dir", "", "额外连接器定义目录")
	asJSON := fs.Bool("json", false, "输出 JSON")
	_ = fs.Parse(args)

	conns, err := connectors.All(*connectorsDir)
	if err != nil {
		fatal(err)
	}
	type appRow struct {
		ID, DisplayName, AuthType string
		Actions                   int
	}
	rows := make([]appRow, 0, len(conns))
	total := 0
	for _, c := range conns {
		rows = append(rows, appRow{c.ID, c.DisplayName, string(c.Auth.Type), len(c.Actions)})
		total += len(c.Actions)
	}
	if *asJSON {
		fmt.Println(prettyJSON(mustMarshal(rows)))
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(w, "ID\t名称\t认证\t动作数")
	for _, r := range rows {
		fmt.Fprintf(w, "%s\t%s\t%s\t%d\n", r.ID, r.DisplayName, r.AuthType, r.Actions)
	}
	_ = w.Flush()
	fmt.Printf("共 %d 个连接器 / %d 个动作\n", len(rows), total)
}

// ---- 工具函数 ----

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".connector-runtime"
	}
	return filepath.Join(home, ".connector-runtime")
}

// ensureToken：flag 显式值 > 已落盘 token > 新生成并落盘（0600）。
func ensureToken(dataDir, filename, val string) string {
	if val != "" {
		return val
	}
	path := filepath.Join(dataDir, filename)
	if b, err := os.ReadFile(path); err == nil {
		if t := strings.TrimSpace(string(b)); t != "" {
			return t
		}
	}
	tok := randHex(24)
	if err := os.WriteFile(path, []byte(tok), 0o600); err != nil {
		fatal(err)
	}
	return tok
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		fatal(err)
	}
	return hex.EncodeToString(b)
}

func prettyJSON(b []byte) string {
	var buf bytes.Buffer
	if json.Indent(&buf, b, "", "  ") == nil {
		return buf.String()
	}
	return string(b)
}

func mustMarshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		fatal(err)
	}
	return b
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "错误:", err)
	os.Exit(1)
}
