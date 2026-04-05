package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// TeamInfo represents a GitHub team returned by the discovery service.
type TeamInfo struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// execCommandFn is used to create exec.Cmd — overridable in tests.
var execCommandFn = exec.Command

// resolveDiscoverScript finds the discover.ts script relative to the TUI binary.
func resolveDiscoverScript() string {
	// Relative to the binary itself (installed layout)
	exePath, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exePath)
		candidate := filepath.Join(dir, "..", "scripts", "discover.ts")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}

	// Relative to CWD (development layout)
	candidate := filepath.Join("scripts", "discover.ts")
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}

	// Absolute fallback
	home, _ := os.UserHomeDir()
	locations := []string{
		filepath.Join(home, "teamhero.scripts", "scripts", "discover.ts"),
	}
	for _, loc := range locations {
		if _, err := os.Stat(loc); err == nil {
			return loc
		}
	}

	return "scripts/discover.ts"
}

// DiscoverRepos fetches available repository names for an organization.
func DiscoverRepos(org string, includePrivate, includeArchived bool) ([]string, error) {
	args := []string{"run", resolveDiscoverScript(), "--type", "repos", "--org", org}
	if includePrivate {
		args = append(args, "--include-private")
	}
	if includeArchived {
		args = append(args, "--include-archived")
	}

	cmd := execCommandFn(resolveBunBinary(), args...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to discover repos: %w", err)
	}

	var repos []string
	if err := json.Unmarshal(out, &repos); err != nil {
		return nil, fmt.Errorf("failed to parse repos response: %w", err)
	}
	return repos, nil
}

// DiscoverTeams fetches available teams for an organization.
func DiscoverTeams(org string) ([]TeamInfo, error) {
	args := []string{"run", resolveDiscoverScript(), "--type", "teams", "--org", org}

	cmd := execCommandFn(resolveBunBinary(), args...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to discover teams: %w", err)
	}

	var teams []TeamInfo
	if err := json.Unmarshal(out, &teams); err != nil {
		return nil, fmt.Errorf("failed to parse teams response: %w", err)
	}
	return teams, nil
}

// DiscoverMembers fetches available member logins for an organization.
func DiscoverMembers(org string) ([]string, error) {
	args := []string{"run", resolveDiscoverScript(), "--type", "members", "--org", org}

	cmd := execCommandFn(resolveBunBinary(), args...)
	cmd.Stderr = os.Stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to discover members: %w", err)
	}

	var members []string
	if err := json.Unmarshal(out, &members); err != nil {
		return nil, fmt.Errorf("failed to parse members response: %w", err)
	}
	return members, nil
}
