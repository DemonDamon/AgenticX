package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var (
	ErrPathEscape   = errors.New("sandbox: path outside workspace")
	ErrEmptyCommand = errors.New("sandbox: empty command")
)

// Config controls sandbox execution limits.
type Config struct {
	CommandTimeout time.Duration
	MaxOutputBytes int
}

func DefaultConfig() Config {
	return Config{
		CommandTimeout: 30 * time.Second,
		MaxOutputBytes: 1 << 20,
	}
}

// Sandbox runs agent tool actions inside an isolated temporary workspace.
type Sandbox struct {
	workDir string
	cfg     Config
}

// New creates a sandbox with a fresh temporary workspace directory.
func New(cfg Config) (*Sandbox, error) {
	if cfg.CommandTimeout <= 0 {
		cfg.CommandTimeout = DefaultConfig().CommandTimeout
	}
	if cfg.MaxOutputBytes <= 0 {
		cfg.MaxOutputBytes = DefaultConfig().MaxOutputBytes
	}
	dir, err := os.MkdirTemp("", "agx-edge-sandbox-*")
	if err != nil {
		return nil, fmt.Errorf("create sandbox dir: %w", err)
	}
	return &Sandbox{workDir: dir, cfg: cfg}, nil
}

// WorkDir returns the absolute sandbox workspace path.
func (s *Sandbox) WorkDir() string {
	return s.workDir
}

// Close removes the temporary workspace.
func (s *Sandbox) Close() error {
	if s.workDir == "" {
		return nil
	}
	err := os.RemoveAll(s.workDir)
	s.workDir = ""
	return err
}

// ResolvePath validates relPath stays inside the workspace after cleaning symlinks.
func (s *Sandbox) ResolvePath(relPath string) (string, error) {
	if strings.TrimSpace(relPath) == "" {
		return "", fmt.Errorf("sandbox: empty path")
	}
	clean := filepath.Clean(relPath)
	if filepath.IsAbs(clean) {
		return "", ErrPathEscape
	}
	root, err := filepath.Abs(s.workDir)
	if err != nil {
		return "", err
	}
	rootEval, err := filepath.EvalSymlinks(root)
	if err != nil {
		rootEval = root
	}
	target := filepath.Join(rootEval, clean)
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	evalTarget, err := filepath.EvalSymlinks(absTarget)
	if err != nil {
		if !os.IsNotExist(err) {
			return "", err
		}
		evalTarget = absTarget
	}
	rel, err := filepath.Rel(rootEval, evalTarget)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", ErrPathEscape
	}
	return absTarget, nil
}

// WriteFile writes content to a path relative to the workspace.
func (s *Sandbox) WriteFile(relPath, content string) error {
	target, err := s.ResolvePath(relPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	return os.WriteFile(target, []byte(content), 0o600)
}

// ReadFile reads a workspace-relative file.
func (s *Sandbox) ReadFile(relPath string) (string, error) {
	target, err := s.ResolvePath(relPath)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// RunCommand executes argv[0] with args inside the workspace directory.
func (s *Sandbox) RunCommand(ctx context.Context, argv []string) (stdout string, stderr string, err error) {
	if len(argv) == 0 || strings.TrimSpace(argv[0]) == "" {
		return "", "", ErrEmptyCommand
	}
	runCtx, cancel := context.WithTimeout(ctx, s.cfg.CommandTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, argv[0], argv[1:]...)
	cmd.Dir = s.workDir
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + s.workDir, "TMPDIR=" + s.workDir}

	out, cmdErr := cmd.CombinedOutput()
	if len(out) > s.cfg.MaxOutputBytes {
		out = out[:s.cfg.MaxOutputBytes]
	}
	text := string(out)
	if cmdErr != nil {
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			return text, "", fmt.Errorf("sandbox: command timeout: %w", context.DeadlineExceeded)
		}
		return text, "", cmdErr
	}
	return text, "", nil
}
