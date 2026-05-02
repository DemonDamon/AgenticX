package policyengine

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

func LoadRulePacks(manifestGlob string) ([]RulePackManifest, error) {
	return LoadRulePacksWithDisabled(manifestGlob, nil)
}

func LoadRulePacksWithDisabled(manifestGlob string, disabledPacks map[string]bool) ([]RulePackManifest, error) {
	files, err := filepath.Glob(manifestGlob)
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no manifest matched: %s", manifestGlob)
	}

	manifests := make(map[string]RulePackManifest, len(files))
	for _, file := range files {
		content, readErr := os.ReadFile(file)
		if readErr != nil {
			return nil, readErr
		}
		var manifest RulePackManifest
		if unmarshalErr := yaml.Unmarshal(content, &manifest); unmarshalErr != nil {
			return nil, unmarshalErr
		}
		if strings.TrimSpace(manifest.Name) == "" {
			return nil, fmt.Errorf("manifest missing name: %s", file)
		}
		manifests[manifest.Name] = manifest
	}

	resolved := make([]RulePackManifest, 0, len(manifests))
	visited := make(map[string]bool, len(manifests))
	stack := make(map[string]bool, len(manifests))

	var dfs func(name string) (RulePackManifest, error)
	dfs = func(name string) (RulePackManifest, error) {
		manifest, ok := manifests[name]
		if !ok {
			return RulePackManifest{}, fmt.Errorf("extends target not found: %s", name)
		}
		if stack[name] {
			return RulePackManifest{}, errors.New("extends contains cycle")
		}
		if visited[name] {
			return manifests[name], nil
		}
		stack[name] = true
		if parent := strings.TrimSpace(manifest.Extends); parent != "" && !disabledPacks[parent] {
			parentManifest, parentErr := dfs(parent)
			if parentErr != nil {
				return RulePackManifest{}, parentErr
			}
			manifest.Rules = append(parentManifest.Rules, manifest.Rules...)
		}
		stack[name] = false
		visited[name] = true
		manifests[name] = manifest
		return manifest, nil
	}

	for name := range manifests {
		if disabledPacks[name] {
			continue
		}
		manifest, resolveErr := dfs(name)
		if resolveErr != nil {
			return nil, resolveErr
		}
		resolved = append(resolved, manifest)
	}
	return resolved, nil
}
