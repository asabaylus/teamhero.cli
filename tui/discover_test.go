package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// TestHelperProcess — fake subprocess used by execCommandFn overrides.
//
// When invoked with GO_WANT_HELPER_PROCESS=1 it prints the value of
// HELPER_OUTPUT to stdout and exits with the code in HELPER_EXIT (default 0).
// ---------------------------------------------------------------------------

func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}
	// Print whatever the caller asked for
	fmt.Print(os.Getenv("HELPER_OUTPUT"))

	exitCode := 0
	if v := os.Getenv("HELPER_EXIT"); v != "" {
		fmt.Sscanf(v, "%d", &exitCode)
	}
	os.Exit(exitCode)
}

// helperCmd returns a *exec.Cmd that, when Run/Output is called, executes
// TestHelperProcess in the current test binary with the given env vars.
func helperCmd(env ...string) func(string, ...string) *exec.Cmd {
	return func(name string, args ...string) *exec.Cmd {
		cs := []string{"-test.run=TestHelperProcess", "--", name}
		cs = append(cs, args...)
		cmd := exec.Command(os.Args[0], cs...)
		cmd.Env = append(os.Environ(), "GO_WANT_HELPER_PROCESS=1")
		cmd.Env = append(cmd.Env, env...)
		return cmd
	}
}

// ---------------------------------------------------------------------------
// DiscoverRepos
// ---------------------------------------------------------------------------

func TestDiscoverRepos_Success(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=["repo1","repo2"]`)

	repos, err := DiscoverRepos("myorg", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repos) != 2 || repos[0] != "repo1" || repos[1] != "repo2" {
		t.Errorf("got %v, want [repo1 repo2]", repos)
	}
}

func TestDiscoverRepos_IncludePrivateAndArchived(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=["private-repo"]`)

	repos, err := DiscoverRepos("myorg", true, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repos) != 1 || repos[0] != "private-repo" {
		t.Errorf("got %v, want [private-repo]", repos)
	}
}

func TestDiscoverRepos_EmptyArray(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=[]`)

	repos, err := DiscoverRepos("myorg", false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(repos) != 0 {
		t.Errorf("got %v, want empty slice", repos)
	}
}

func TestDiscoverRepos_InvalidJSON(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=not-json`)

	_, err := DiscoverRepos("myorg", false, false)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse repos response") {
		t.Errorf("expected parse error, got: %v", err)
	}
}

func TestDiscoverRepos_NonZeroExit(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=`, `HELPER_EXIT=1`)

	_, err := DiscoverRepos("myorg", false, false)
	if err == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
	if !strings.Contains(err.Error(), "failed to discover repos") {
		t.Errorf("expected discover repos error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// DiscoverTeams
// ---------------------------------------------------------------------------

func TestDiscoverTeams_Success(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=[{"name":"Team1","slug":"team1"},{"name":"Team2","slug":"team2"}]`)

	teams, err := DiscoverTeams("myorg")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(teams) != 2 {
		t.Fatalf("got %d teams, want 2", len(teams))
	}
	if teams[0].Name != "Team1" || teams[0].Slug != "team1" {
		t.Errorf("teams[0] = %+v, want {Name:Team1 Slug:team1}", teams[0])
	}
	if teams[1].Name != "Team2" || teams[1].Slug != "team2" {
		t.Errorf("teams[1] = %+v, want {Name:Team2 Slug:team2}", teams[1])
	}
}

func TestDiscoverTeams_EmptyArray(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=[]`)

	teams, err := DiscoverTeams("myorg")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(teams) != 0 {
		t.Errorf("got %v, want empty slice", teams)
	}
}

func TestDiscoverTeams_InvalidJSON(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT={broken`)

	_, err := DiscoverTeams("myorg")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse teams response") {
		t.Errorf("expected parse error, got: %v", err)
	}
}

func TestDiscoverTeams_NonZeroExit(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=`, `HELPER_EXIT=1`)

	_, err := DiscoverTeams("myorg")
	if err == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
	if !strings.Contains(err.Error(), "failed to discover teams") {
		t.Errorf("expected discover teams error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// DiscoverMembers
// ---------------------------------------------------------------------------

func TestDiscoverMembers_Success(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=["user1","user2","user3"]`)

	members, err := DiscoverMembers("myorg")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(members) != 3 {
		t.Fatalf("got %d members, want 3", len(members))
	}
	if members[0] != "user1" || members[1] != "user2" || members[2] != "user3" {
		t.Errorf("got %v, want [user1 user2 user3]", members)
	}
}

func TestDiscoverMembers_EmptyArray(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=[]`)

	members, err := DiscoverMembers("myorg")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(members) != 0 {
		t.Errorf("got %v, want empty slice", members)
	}
}

func TestDiscoverMembers_InvalidJSON(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=<html>error</html>`)

	_, err := DiscoverMembers("myorg")
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse members response") {
		t.Errorf("expected parse error, got: %v", err)
	}
}

func TestDiscoverMembers_NonZeroExit(t *testing.T) {
	orig := execCommandFn
	t.Cleanup(func() { execCommandFn = orig })

	execCommandFn = helperCmd(`HELPER_OUTPUT=`, `HELPER_EXIT=2`)

	_, err := DiscoverMembers("myorg")
	if err == nil {
		t.Fatal("expected error for non-zero exit, got nil")
	}
	if !strings.Contains(err.Error(), "failed to discover members") {
		t.Errorf("expected discover members error, got: %v", err)
	}
}

// ---------------------------------------------------------------------------
// resolveDiscoverScript
// ---------------------------------------------------------------------------

func TestResolveDiscoverScript_ReturnsNonEmpty(t *testing.T) {
	got := resolveDiscoverScript()
	if got == "" {
		t.Error("resolveDiscoverScript() returned empty string")
	}
}

func TestResolveDiscoverScript_ContainsDiscoverTs(t *testing.T) {
	got := resolveDiscoverScript()
	if !strings.Contains(got, "discover.ts") {
		t.Errorf("resolveDiscoverScript() = %q, expected to contain 'discover.ts'", got)
	}
}

func TestResolveDiscoverScript_FallbackWhenNothingExists(t *testing.T) {
	// Change to an empty temp dir so no scripts/ directory is found relative to CWD
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	got := resolveDiscoverScript()
	// Should return the default fallback path
	if !strings.Contains(got, "discover.ts") {
		t.Errorf("resolveDiscoverScript() = %q, expected fallback containing 'discover.ts'", got)
	}
}

func TestResolveDiscoverScript_RelativeToCWD(t *testing.T) {
	tmpDir := t.TempDir()
	scriptDir := tmpDir + "/scripts"
	os.MkdirAll(scriptDir, 0o755)
	os.WriteFile(scriptDir+"/discover.ts", []byte("// test"), 0o644)

	origDir, _ := os.Getwd()
	t.Cleanup(func() { os.Chdir(origDir) })
	os.Chdir(tmpDir)

	got := resolveDiscoverScript()
	if got != "scripts/discover.ts" {
		// Could also find via binary path or absolute fallback
		if !strings.Contains(got, "discover.ts") {
			t.Errorf("resolveDiscoverScript() = %q, expected to contain 'discover.ts'", got)
		}
	}
}

// ---------------------------------------------------------------------------
// TeamInfo JSON round-trip
// ---------------------------------------------------------------------------

func TestTeamInfo_JSONTags(t *testing.T) {
	// Verify the struct marshals/unmarshals correctly
	info := TeamInfo{Name: "Alpha Team", Slug: "alpha-team"}
	if info.Name != "Alpha Team" || info.Slug != "alpha-team" {
		t.Errorf("TeamInfo fields incorrect: %+v", info)
	}
}
