package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStrPtr(t *testing.T) {
	s := "hello"
	ptr := strPtr(s)
	if ptr == nil {
		t.Fatal("strPtr returned nil")
	}
	if *ptr != s {
		t.Errorf("strPtr(%q) = %q, want %q", s, *ptr, s)
	}
}

func TestStrPtr_Empty(t *testing.T) {
	ptr := strPtr("")
	if ptr == nil {
		t.Fatal("strPtr returned nil for empty string")
	}
	if *ptr != "" {
		t.Errorf("strPtr(\"\") = %q, want empty string", *ptr)
	}
}

func TestCheckConfigFile_ValidJSON(t *testing.T) {
	// Create a temporary config directory
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	validJSON := `{"org": "test-org", "members": []}`
	if err := os.WriteFile(filepath.Join(configPath, "config.json"), []byte(validJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	check := checkConfigFile()
	if !check.Passed {
		t.Errorf("checkConfigFile should pass for valid JSON, got message: %s", check.Message)
	}
	if check.Name != "config_file" {
		t.Errorf("checkConfigFile name = %q, want %q", check.Name, "config_file")
	}
	if check.Category != "files" {
		t.Errorf("checkConfigFile category = %q, want %q", check.Category, "files")
	}
}

func TestCheckConfigFile_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	invalidJSON := `{not valid json`
	if err := os.WriteFile(filepath.Join(configPath, "config.json"), []byte(invalidJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	check := checkConfigFile()
	if check.Passed {
		t.Error("checkConfigFile should fail for invalid JSON")
	}
	if check.Detail == nil {
		t.Error("checkConfigFile should have detail for invalid JSON")
	}
}

func TestCheckConfigFile_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Don't create the config file
	check := checkConfigFile()
	if check.Passed {
		t.Error("checkConfigFile should fail when file not found")
	}
	if check.Detail == nil {
		t.Error("checkConfigFile should have detail when file not found")
	}
}

func TestCheckEnvFile_Exists_WithRequiredKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	envContent := "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test123\nOPENAI_API_KEY=sk-test456\n"
	if err := os.WriteFile(filepath.Join(configPath, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	checks := checkEnvFile()
	// Should have: env_file present + 2 required keys
	if len(checks) < 3 {
		t.Fatalf("checkEnvFile should return at least 3 checks, got %d", len(checks))
	}

	// First check: file exists
	if !checks[0].Passed {
		t.Error("env_file check should pass when file exists")
	}

	// Key checks should pass
	allPassed := true
	for _, c := range checks[1:] {
		if !c.Passed {
			allPassed = false
			t.Errorf("key check %q should pass, got message: %s", c.Name, c.Message)
		}
	}
	if !allPassed {
		t.Error("all key checks should pass when required keys are present")
	}
}

func TestCheckEnvFile_Exists_MissingKeys(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	// .env file exists but is empty
	if err := os.WriteFile(filepath.Join(configPath, ".env"), []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}

	checks := checkEnvFile()
	if len(checks) < 3 {
		t.Fatalf("checkEnvFile should return at least 3 checks, got %d", len(checks))
	}

	// File exists check should pass
	if !checks[0].Passed {
		t.Error("env_file check should pass even when keys are missing")
	}

	// Key checks should fail
	for _, c := range checks[1:] {
		if c.Passed {
			t.Errorf("key check %q should fail when key is missing", c.Name)
		}
	}
}

func TestCheckEnvFile_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Don't create the .env file
	checks := checkEnvFile()
	if len(checks) != 1 {
		t.Fatalf("checkEnvFile should return 1 check when file not found, got %d", len(checks))
	}
	if checks[0].Passed {
		t.Error("env_file check should fail when file not found")
	}
}

func TestCheckEnvPermissions_CorrectPerms(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	envPath := filepath.Join(configPath, ".env")
	if err := os.WriteFile(envPath, []byte("test=value"), 0o600); err != nil {
		t.Fatal(err)
	}

	check := checkEnvPermissions()
	if !check.Passed {
		t.Errorf("checkEnvPermissions should pass for 600 perms, got message: %s", check.Message)
	}
}

func TestCheckEnvPermissions_WrongPerms(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	envPath := filepath.Join(configPath, ".env")
	if err := os.WriteFile(envPath, []byte("test=value"), 0o644); err != nil {
		t.Fatal(err)
	}

	check := checkEnvPermissions()
	if check.Passed {
		t.Error("checkEnvPermissions should fail for 644 perms")
	}
	if check.Detail == nil {
		t.Error("checkEnvPermissions should have detail for wrong perms")
	}
}

func TestCheckEnvPermissions_FileNotFound(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	check := checkEnvPermissions()
	// Should return warning when file not found
	if !check.Warning {
		t.Error("checkEnvPermissions should return warning when file not found")
	}
}

func TestCheckOutputDirectory_Writable(t *testing.T) {
	tmpDir := t.TempDir()
	origDir, _ := os.Getwd()
	defer os.Chdir(origDir)
	os.Chdir(tmpDir)

	check := checkOutputDirectory()
	if !check.Passed {
		t.Errorf("checkOutputDirectory should pass for writable dir, got message: %s", check.Message)
	}
	if check.Name != "output_directory" {
		t.Errorf("checkOutputDirectory name = %q, want %q", check.Name, "output_directory")
	}
	if check.Category != "directories" {
		t.Errorf("checkOutputDirectory category = %q, want %q", check.Category, "directories")
	}
}

func TestDoctorCheck_JSONSerialization(t *testing.T) {
	detail := "some detail"
	check := DoctorCheck{
		Name:     "test_check",
		Category: "test",
		Passed:   true,
		Warning:  false,
		Message:  "test passed",
		Detail:   &detail,
	}

	data, err := json.Marshal(check)
	if err != nil {
		t.Fatalf("failed to marshal DoctorCheck: %v", err)
	}

	var decoded DoctorCheck
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal DoctorCheck: %v", err)
	}

	if decoded.Name != check.Name {
		t.Errorf("decoded Name = %q, want %q", decoded.Name, check.Name)
	}
	if decoded.Passed != check.Passed {
		t.Errorf("decoded Passed = %v, want %v", decoded.Passed, check.Passed)
	}
	if decoded.Detail == nil || *decoded.Detail != detail {
		t.Errorf("decoded Detail = %v, want %q", decoded.Detail, detail)
	}
}

func TestDoctorResult_JSONSerialization(t *testing.T) {
	result := DoctorResult{
		Version: "1.0.0",
		Healthy: true,
		Checks: []DoctorCheck{
			{Name: "check1", Category: "cat1", Passed: true, Message: "ok"},
		},
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("failed to marshal DoctorResult: %v", err)
	}

	var decoded DoctorResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal DoctorResult: %v", err)
	}

	if decoded.Version != "1.0.0" {
		t.Errorf("decoded Version = %q, want %q", decoded.Version, "1.0.0")
	}
	if !decoded.Healthy {
		t.Error("decoded Healthy should be true")
	}
	if len(decoded.Checks) != 1 {
		t.Fatalf("decoded Checks count = %d, want 1", len(decoded.Checks))
	}
}

// ---------------------------------------------------------------------------
// HTTP check tests using httptest
// ---------------------------------------------------------------------------

// TestDoctorCheckGitHubTokenWith tests all branches of checkGitHubTokenWith.
func TestDoctorCheckGitHubTokenWith(t *testing.T) {
	t.Run("empty token returns not configured", func(t *testing.T) {
		creds := map[string]string{}
		check := checkGitHubTokenWith(creds, http.DefaultClient)
		if check.Passed {
			t.Error("expected Passed=false for empty token")
		}
		if check.Name != "github_token" {
			t.Errorf("Name = %q, want %q", check.Name, "github_token")
		}
		if check.Category != "credentials" {
			t.Errorf("Category = %q, want %q", check.Category, "credentials")
		}
		if !strings.Contains(check.Message, "not configured") {
			t.Errorf("Message = %q, expected to contain 'not configured'", check.Message)
		}
		if check.Detail == nil {
			t.Error("Detail should not be nil for missing token")
		}
	})

	t.Run("401 response returns token invalid", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/user" {
				t.Errorf("unexpected path: %s", r.URL.Path)
			}
			if r.Header.Get("Authorization") != "Bearer test-token" {
				t.Errorf("unexpected Authorization header: %s", r.Header.Get("Authorization"))
			}
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubTokenWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 401 response")
		}
		if !strings.Contains(check.Message, "invalid or expired") {
			t.Errorf("Message = %q, expected to contain 'invalid or expired'", check.Message)
		}
	})

	t.Run("200 with login JSON returns connected as user", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"login":"octocat"}`)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Message != "GitHub: Connected as @octocat" {
			t.Errorf("Message = %q, want %q", check.Message, "GitHub: Connected as @octocat")
		}
		if check.Detail != nil {
			t.Error("Detail should be nil on success")
		}
	})

	t.Run("200 without login returns authenticated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{}`)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Message != "GitHub: authenticated" {
			t.Errorf("Message = %q, want %q", check.Message, "GitHub: authenticated")
		}
	})

	t.Run("200 with invalid JSON body falls back to authenticated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `not json`)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true even with bad JSON body, got message: %s", check.Message)
		}
		// login will be empty so it falls back to "authenticated"
		if check.Message != "GitHub: authenticated" {
			t.Errorf("Message = %q, want %q", check.Message, "GitHub: authenticated")
		}
	})

	t.Run("connection error returns connection failed", func(t *testing.T) {
		// Point to a server that immediately closes
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		srv.Close() // close immediately to cause connection error

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubTokenWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for connection error")
		}
		if !strings.Contains(check.Message, "connection failed") {
			t.Errorf("Message = %q, expected to contain 'connection failed'", check.Message)
		}
	})

	t.Run("403 response returns token invalid", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubTokenWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 403 response")
		}
		if !strings.Contains(check.Message, "invalid or expired") {
			t.Errorf("Message = %q, expected to contain 'invalid or expired'", check.Message)
		}
	})

	t.Run("sends correct headers", func(t *testing.T) {
		var gotAuth, gotAccept string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			gotAccept = r.Header.Get("Accept")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"login":"test"}`)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "my-secret-token"}
		checkGitHubTokenWith(creds, srv.Client())

		if gotAuth != "Bearer my-secret-token" {
			t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer my-secret-token")
		}
		if gotAccept != "application/vnd.github+json" {
			t.Errorf("Accept = %q, want %q", gotAccept, "application/vnd.github+json")
		}
	})
}

// TestDoctorCheckGitHubOrgWith tests all branches of checkGitHubOrgWith.
func TestDoctorCheckGitHubOrgWith(t *testing.T) {
	t.Run("empty org returns warning", func(t *testing.T) {
		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubOrgWith(creds, "", http.DefaultClient)
		if !check.Passed {
			t.Error("expected Passed=true for empty org (warning)")
		}
		if !check.Warning {
			t.Error("expected Warning=true for empty org")
		}
		if check.Name != "github_org" {
			t.Errorf("Name = %q, want %q", check.Name, "github_org")
		}
		if !strings.Contains(check.Message, "no org configured") {
			t.Errorf("Message = %q, expected to contain 'no org configured'", check.Message)
		}
	})

	t.Run("empty token returns warning skip", func(t *testing.T) {
		creds := map[string]string{}
		check := checkGitHubOrgWith(creds, "my-org", http.DefaultClient)
		if !check.Passed {
			t.Error("expected Passed=true for empty token (warning)")
		}
		if !check.Warning {
			t.Error("expected Warning=true for empty token")
		}
		if !strings.Contains(check.Message, "skipped") {
			t.Errorf("Message = %q, expected to contain 'skipped'", check.Message)
		}
	})

	t.Run("404 response returns cannot access", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/orgs/test-org" {
				t.Errorf("unexpected path: %s, want /orgs/test-org", r.URL.Path)
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubOrgWith(creds, "test-org", srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 404")
		}
		if !strings.Contains(check.Message, "cannot access test-org") {
			t.Errorf("Message = %q, expected to contain 'cannot access test-org'", check.Message)
		}
		if check.Detail == nil {
			t.Error("Detail should not be nil for 404")
		}
		if !strings.Contains(*check.Detail, "read:org") {
			t.Errorf("Detail = %q, expected to mention 'read:org'", *check.Detail)
		}
	})

	t.Run("200 response returns accessible", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"login":"test-org"}`)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubOrgWith(creds, "test-org", srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Warning {
			t.Error("expected Warning=false for successful org check")
		}
		if check.Message != "GitHub org: test-org accessible" {
			t.Errorf("Message = %q, want %q", check.Message, "GitHub org: test-org accessible")
		}
		if check.Detail != nil {
			t.Error("Detail should be nil on success")
		}
	})

	t.Run("connection error returns connection failed", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubOrgWith(creds, "my-org", srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for connection error")
		}
		if !strings.Contains(check.Message, "connection failed") {
			t.Errorf("Message = %q, expected to contain 'connection failed'", check.Message)
		}
		if !strings.Contains(check.Message, "my-org") {
			t.Errorf("Message = %q, expected to contain org name 'my-org'", check.Message)
		}
	})

	t.Run("sends correct headers with org in path", func(t *testing.T) {
		var gotPath, gotAuth string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			gotAuth = r.Header.Get("Authorization")
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "pat-123"}
		checkGitHubOrgWith(creds, "acme-corp", srv.Client())

		if gotPath != "/orgs/acme-corp" {
			t.Errorf("Path = %q, want %q", gotPath, "/orgs/acme-corp")
		}
		if gotAuth != "Bearer pat-123" {
			t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer pat-123")
		}
	})

	t.Run("403 response returns cannot access", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		}))
		defer srv.Close()

		origURL := githubAPIBaseURL
		githubAPIBaseURL = srv.URL
		t.Cleanup(func() { githubAPIBaseURL = origURL })

		creds := map[string]string{"GITHUB_PERSONAL_ACCESS_TOKEN": "test-token"}
		check := checkGitHubOrgWith(creds, "secret-org", srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 403")
		}
		if !strings.Contains(check.Message, "cannot access secret-org") {
			t.Errorf("Message = %q, expected to contain 'cannot access secret-org'", check.Message)
		}
	})
}

// TestDoctorCheckOpenAIKeyWith tests all branches of checkOpenAIKeyWith.
func TestDoctorCheckOpenAIKeyWith(t *testing.T) {
	t.Run("empty key returns not configured", func(t *testing.T) {
		creds := map[string]string{}
		check := checkOpenAIKeyWith(creds, http.DefaultClient)
		if check.Passed {
			t.Error("expected Passed=false for empty key")
		}
		if check.Name != "openai_key" {
			t.Errorf("Name = %q, want %q", check.Name, "openai_key")
		}
		if check.Category != "credentials" {
			t.Errorf("Category = %q, want %q", check.Category, "credentials")
		}
		if !strings.Contains(check.Message, "not configured") {
			t.Errorf("Message = %q, expected to contain 'not configured'", check.Message)
		}
		if check.Detail == nil {
			t.Error("Detail should not be nil for missing key")
		}
	})

	t.Run("401 response returns key invalid", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/v1/responses" {
				t.Errorf("unexpected path: %s", r.URL.Path)
			}
			if r.Method != "POST" {
				t.Errorf("unexpected method: %s, want POST", r.Method)
			}
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()

		origURL := openAIAPIBaseURL
		openAIAPIBaseURL = srv.URL
		t.Cleanup(func() { openAIAPIBaseURL = origURL })

		creds := map[string]string{"OPENAI_API_KEY": "sk-bad-key"}
		check := checkOpenAIKeyWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 401 response")
		}
		if !strings.Contains(check.Message, "invalid or expired") {
			t.Errorf("Message = %q, expected to contain 'invalid or expired'", check.Message)
		}
	})

	t.Run("200 response returns valid key", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"id":"resp_abc123"}`)
		}))
		defer srv.Close()

		origURL := openAIAPIBaseURL
		openAIAPIBaseURL = srv.URL
		t.Cleanup(func() { openAIAPIBaseURL = origURL })

		creds := map[string]string{"OPENAI_API_KEY": "sk-valid-key"}
		check := checkOpenAIKeyWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Message != "OpenAI: API key valid" {
			t.Errorf("Message = %q, want %q", check.Message, "OpenAI: API key valid")
		}
		if check.Detail != nil {
			t.Error("Detail should be nil on success")
		}
	})

	t.Run("non-401 error status still returns valid", func(t *testing.T) {
		// The code only checks for 401 specifically; other errors (e.g. 429, 500)
		// still count as "key valid" (the key was accepted, it's a different error).
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}))
		defer srv.Close()

		origURL := openAIAPIBaseURL
		openAIAPIBaseURL = srv.URL
		t.Cleanup(func() { openAIAPIBaseURL = origURL })

		creds := map[string]string{"OPENAI_API_KEY": "sk-valid-key"}
		check := checkOpenAIKeyWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true for 429 (not a 401), got message: %s", check.Message)
		}
	})

	t.Run("connection error returns connection failed", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		srv.Close()

		origURL := openAIAPIBaseURL
		openAIAPIBaseURL = srv.URL
		t.Cleanup(func() { openAIAPIBaseURL = origURL })

		creds := map[string]string{"OPENAI_API_KEY": "sk-test"}
		check := checkOpenAIKeyWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for connection error")
		}
		if !strings.Contains(check.Message, "connection failed") {
			t.Errorf("Message = %q, expected to contain 'connection failed'", check.Message)
		}
	})

	t.Run("sends correct headers and body", func(t *testing.T) {
		var gotAuth, gotContentType, gotMethod string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			gotContentType = r.Header.Get("Content-Type")
			gotMethod = r.Method
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		origURL := openAIAPIBaseURL
		openAIAPIBaseURL = srv.URL
		t.Cleanup(func() { openAIAPIBaseURL = origURL })

		creds := map[string]string{"OPENAI_API_KEY": "sk-secret123"}
		checkOpenAIKeyWith(creds, srv.Client())

		if gotAuth != "Bearer sk-secret123" {
			t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer sk-secret123")
		}
		if gotContentType != "application/json" {
			t.Errorf("Content-Type = %q, want %q", gotContentType, "application/json")
		}
		if gotMethod != "POST" {
			t.Errorf("Method = %q, want %q", gotMethod, "POST")
		}
	})
}

// TestDoctorCheckAsanaTokenWith tests all branches of checkAsanaTokenWith.
func TestDoctorCheckAsanaTokenWith(t *testing.T) {
	t.Run("empty token returns not configured optional", func(t *testing.T) {
		creds := map[string]string{}
		check := checkAsanaTokenWith(creds, http.DefaultClient)
		if !check.Passed {
			t.Error("expected Passed=true for empty token (optional)")
		}
		if !check.Warning {
			t.Error("expected Warning=true for empty token")
		}
		if check.Name != "asana_token" {
			t.Errorf("Name = %q, want %q", check.Name, "asana_token")
		}
		if check.Category != "credentials" {
			t.Errorf("Category = %q, want %q", check.Category, "credentials")
		}
		if !strings.Contains(check.Message, "not configured") {
			t.Errorf("Message = %q, expected to contain 'not configured'", check.Message)
		}
		if !strings.Contains(check.Message, "optional") {
			t.Errorf("Message = %q, expected to contain 'optional'", check.Message)
		}
		if check.Detail != nil {
			t.Error("Detail should be nil for optional not configured")
		}
	})

	t.Run("401 response returns token invalid", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/users/me" {
				t.Errorf("unexpected path: %s", r.URL.Path)
			}
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "bad-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 401 response")
		}
		if check.Warning {
			t.Error("expected Warning=false for invalid token")
		}
		if !strings.Contains(check.Message, "invalid or expired") {
			t.Errorf("Message = %q, expected to contain 'invalid or expired'", check.Message)
		}
	})

	t.Run("200 with name returns connected as Name", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"data":{"name":"Jane Doe","gid":"12345"}}`)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "valid-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Warning {
			t.Error("expected Warning=false for successful auth")
		}
		if check.Message != "Asana: Connected as Jane Doe" {
			t.Errorf("Message = %q, want %q", check.Message, "Asana: Connected as Jane Doe")
		}
		if check.Detail != nil {
			t.Error("Detail should be nil on success")
		}
	})

	t.Run("200 without name returns authenticated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"data":{}}`)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "valid-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Message != "Asana: authenticated" {
			t.Errorf("Message = %q, want %q", check.Message, "Asana: authenticated")
		}
	})

	t.Run("200 with empty JSON falls back to authenticated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{}`)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "valid-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Message != "Asana: authenticated" {
			t.Errorf("Message = %q, want %q", check.Message, "Asana: authenticated")
		}
	})

	t.Run("200 with invalid JSON falls back to authenticated", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `not json at all`)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "valid-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if !check.Passed {
			t.Errorf("expected Passed=true even with bad JSON body, got message: %s", check.Message)
		}
		if check.Message != "Asana: authenticated" {
			t.Errorf("Message = %q, want %q", check.Message, "Asana: authenticated")
		}
	})

	t.Run("connection error returns connection failed", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "test-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for connection error")
		}
		if !strings.Contains(check.Message, "connection failed") {
			t.Errorf("Message = %q, expected to contain 'connection failed'", check.Message)
		}
	})

	t.Run("403 response returns token invalid", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "test-token"}
		check := checkAsanaTokenWith(creds, srv.Client())
		if check.Passed {
			t.Error("expected Passed=false for 403")
		}
		if !strings.Contains(check.Message, "invalid or expired") {
			t.Errorf("Message = %q, expected to contain 'invalid or expired'", check.Message)
		}
	})

	t.Run("sends correct authorization header", func(t *testing.T) {
		var gotAuth string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"data":{"name":"Test"}}`)
		}))
		defer srv.Close()

		origURL := asanaAPIBaseURL
		asanaAPIBaseURL = srv.URL
		t.Cleanup(func() { asanaAPIBaseURL = origURL })

		creds := map[string]string{"ASANA_API_TOKEN": "asana-secret-789"}
		checkAsanaTokenWith(creds, srv.Client())

		if gotAuth != "Bearer asana-secret-789" {
			t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer asana-secret-789")
		}
	})
}

// TestDoctorCheckGoogleDriveAuth tests all branches of checkGoogleDriveAuth.
func TestDoctorCheckGoogleDriveAuth(t *testing.T) {
	t.Run("no token file returns not configured optional", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("XDG_CONFIG_HOME", tmpDir)

		// Ensure teamhero dir exists but no google-tokens.json
		configPath := filepath.Join(tmpDir, "teamhero")
		if err := os.MkdirAll(configPath, 0o755); err != nil {
			t.Fatal(err)
		}

		check := checkGoogleDriveAuth()
		if !check.Passed {
			t.Error("expected Passed=true for missing file (optional)")
		}
		if !check.Warning {
			t.Error("expected Warning=true for missing file")
		}
		if check.Name != "google_drive" {
			t.Errorf("Name = %q, want %q", check.Name, "google_drive")
		}
		if check.Category != "credentials" {
			t.Errorf("Category = %q, want %q", check.Category, "credentials")
		}
		if !strings.Contains(check.Message, "not configured") {
			t.Errorf("Message = %q, expected to contain 'not configured'", check.Message)
		}
		if check.Detail == nil {
			t.Error("Detail should not be nil (should suggest setup)")
		}
	})

	t.Run("invalid JSON returns invalid token file", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("XDG_CONFIG_HOME", tmpDir)

		configPath := filepath.Join(tmpDir, "teamhero")
		if err := os.MkdirAll(configPath, 0o755); err != nil {
			t.Fatal(err)
		}

		tokenPath := filepath.Join(configPath, "google-tokens.json")
		if err := os.WriteFile(tokenPath, []byte("not json {{{"), 0o600); err != nil {
			t.Fatal(err)
		}

		check := checkGoogleDriveAuth()
		if check.Passed {
			t.Error("expected Passed=false for invalid JSON")
		}
		if check.Warning {
			t.Error("expected Warning=false for invalid JSON (this is a real error)")
		}
		if !strings.Contains(check.Message, "invalid token file") {
			t.Errorf("Message = %q, expected to contain 'invalid token file'", check.Message)
		}
		if check.Detail == nil {
			t.Error("Detail should not be nil")
		}
	})

	t.Run("missing refresh_token returns missing refresh token", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("XDG_CONFIG_HOME", tmpDir)

		configPath := filepath.Join(tmpDir, "teamhero")
		if err := os.MkdirAll(configPath, 0o755); err != nil {
			t.Fatal(err)
		}

		// Valid JSON but missing refresh_token key
		tokenData := `{"access_token":"ya29.test","token_type":"Bearer"}`
		tokenPath := filepath.Join(configPath, "google-tokens.json")
		if err := os.WriteFile(tokenPath, []byte(tokenData), 0o600); err != nil {
			t.Fatal(err)
		}

		check := checkGoogleDriveAuth()
		if check.Passed {
			t.Error("expected Passed=false for missing refresh_token")
		}
		if !strings.Contains(check.Message, "missing refresh token") {
			t.Errorf("Message = %q, expected to contain 'missing refresh token'", check.Message)
		}
		if check.Detail == nil {
			t.Error("Detail should not be nil")
		}
	})

	t.Run("valid token file with refresh_token returns configured", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("XDG_CONFIG_HOME", tmpDir)

		configPath := filepath.Join(tmpDir, "teamhero")
		if err := os.MkdirAll(configPath, 0o755); err != nil {
			t.Fatal(err)
		}

		tokenData := `{"access_token":"ya29.test","refresh_token":"1//test-refresh","token_type":"Bearer"}`
		tokenPath := filepath.Join(configPath, "google-tokens.json")
		if err := os.WriteFile(tokenPath, []byte(tokenData), 0o600); err != nil {
			t.Fatal(err)
		}

		check := checkGoogleDriveAuth()
		if !check.Passed {
			t.Errorf("expected Passed=true, got message: %s", check.Message)
		}
		if check.Warning {
			t.Error("expected Warning=false for valid config")
		}
		if check.Message != "Google Drive: configured" {
			t.Errorf("Message = %q, want %q", check.Message, "Google Drive: configured")
		}
		if check.Detail != nil {
			t.Error("Detail should be nil on success")
		}
	})

	t.Run("empty JSON object missing refresh_token returns missing", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("XDG_CONFIG_HOME", tmpDir)

		configPath := filepath.Join(tmpDir, "teamhero")
		if err := os.MkdirAll(configPath, 0o755); err != nil {
			t.Fatal(err)
		}

		tokenPath := filepath.Join(configPath, "google-tokens.json")
		if err := os.WriteFile(tokenPath, []byte(`{}`), 0o600); err != nil {
			t.Fatal(err)
		}

		check := checkGoogleDriveAuth()
		if check.Passed {
			t.Error("expected Passed=false for empty JSON (no refresh_token)")
		}
		if !strings.Contains(check.Message, "missing refresh token") {
			t.Errorf("Message = %q, expected to contain 'missing refresh token'", check.Message)
		}
	})

	t.Run("config dir does not exist returns not configured", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("XDG_CONFIG_HOME", tmpDir)
		// Do NOT create teamhero subdir — configDir() returns a non-existent path

		check := checkGoogleDriveAuth()
		if !check.Passed {
			t.Error("expected Passed=true for non-existent config dir (optional)")
		}
		if !check.Warning {
			t.Error("expected Warning=true for non-existent config dir")
		}
	})
}

// ---------------------------------------------------------------------------
// runDoctor integration test
// ---------------------------------------------------------------------------

// TestDoctorRunDoctor_HealthyWithAllServices tests runDoctor end-to-end with
// all API endpoints mocked to return success, config and env files present.
func TestDoctorRunDoctor_HealthyWithAllServices(t *testing.T) {
	// Set up temp config directory with valid files
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	// Valid config.json with org so GitHub org check works
	configJSON := `{"org":"test-org","members":[]}`
	if err := os.WriteFile(filepath.Join(configPath, "config.json"), []byte(configJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	// .env with all credentials
	envContent := "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test123\nOPENAI_API_KEY=sk-test456\nASANA_API_TOKEN=asana-test789\n"
	if err := os.WriteFile(filepath.Join(configPath, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	// google-tokens.json with refresh_token
	googleTokens := `{"refresh_token":"1//test","access_token":"ya29.test"}`
	if err := os.WriteFile(filepath.Join(configPath, "google-tokens.json"), []byte(googleTokens), 0o600); err != nil {
		t.Fatal(err)
	}

	// Mock GitHub API
	githubSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/user":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"login":"testuser"}`)
		case strings.HasPrefix(r.URL.Path, "/orgs/"):
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"login":"test-org"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer githubSrv.Close()

	// Mock OpenAI API
	openAISrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"id":"resp_123"}`)
	}))
	defer openAISrv.Close()

	// Mock Asana API
	asanaSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":{"name":"Test User"}}`)
	}))
	defer asanaSrv.Close()

	// Override package-level vars
	origGitHub := githubAPIBaseURL
	origOpenAI := openAIAPIBaseURL
	origAsana := asanaAPIBaseURL
	origClient := defaultHTTPClient
	githubAPIBaseURL = githubSrv.URL
	openAIAPIBaseURL = openAISrv.URL
	asanaAPIBaseURL = asanaSrv.URL
	defaultHTTPClient = &http.Client{}
	t.Cleanup(func() {
		githubAPIBaseURL = origGitHub
		openAIAPIBaseURL = origOpenAI
		asanaAPIBaseURL = origAsana
		defaultHTTPClient = origClient
	})

	// Force JSON mode via os.Args (runDoctor inspects os.Args for --format=json)
	origArgs := os.Args
	os.Args = []string{"teamhero", "doctor", "--format=json"}
	t.Cleanup(func() { os.Args = origArgs })

	// Capture stdout
	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = origStdout })

	exitCode := runDoctor()

	w.Close()
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if exitCode != 0 {
		t.Errorf("expected exit code 0 (healthy), got %d\nOutput: %s", exitCode, output)
	}

	// Parse the JSON output
	var result DoctorResult
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatalf("failed to parse JSON output: %v\nOutput: %s", err, output)
	}

	if !result.Healthy {
		t.Error("expected Healthy=true")
		for _, c := range result.Checks {
			if !c.Passed && !c.Warning {
				detail := ""
				if c.Detail != nil {
					detail = " detail=" + *c.Detail
				}
				t.Logf("  FAILED: %s (name=%s)%s", c.Message, c.Name, detail)
			}
		}
	}
}

// TestDoctorRunDoctor_UnhealthyMissingCredentials tests runDoctor returns
// exit code 1 when credentials are missing.
func TestDoctorRunDoctor_UnhealthyMissingCredentials(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Create config dir but no files at all — everything should fail
	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	// Override API URLs to avoid real network calls
	origGitHub := githubAPIBaseURL
	origOpenAI := openAIAPIBaseURL
	origAsana := asanaAPIBaseURL
	origClient := defaultHTTPClient
	githubAPIBaseURL = "http://127.0.0.1:1" // unreachable
	openAIAPIBaseURL = "http://127.0.0.1:1"
	asanaAPIBaseURL = "http://127.0.0.1:1"
	defaultHTTPClient = &http.Client{}
	t.Cleanup(func() {
		githubAPIBaseURL = origGitHub
		openAIAPIBaseURL = origOpenAI
		asanaAPIBaseURL = origAsana
		defaultHTTPClient = origClient
	})

	// Force JSON mode
	origArgs := os.Args
	os.Args = []string{"teamhero", "doctor", "--format=json"}
	t.Cleanup(func() { os.Args = origArgs })

	// Capture stdout
	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = origStdout })

	exitCode := runDoctor()

	w.Close()
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if exitCode != 1 {
		t.Errorf("expected exit code 1 (unhealthy), got %d\nOutput: %s", exitCode, output)
	}

	var result DoctorResult
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatalf("failed to parse JSON output: %v\nOutput: %s", err, output)
	}

	if result.Healthy {
		t.Error("expected Healthy=false when credentials are missing")
	}

	// Should have at least some failed checks
	failCount := 0
	for _, c := range result.Checks {
		if !c.Passed && !c.Warning {
			failCount++
		}
	}
	if failCount == 0 {
		t.Error("expected at least one failed check when no credentials exist")
	}
}

// TestDoctorRunDoctor_JSONOutputContainsAllCheckNames verifies that all
// expected check names are present in the doctor output.
func TestDoctorRunDoctor_JSONOutputContainsAllCheckNames(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	// Create .env with credentials (so all credential checks run)
	envContent := "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_test\nOPENAI_API_KEY=sk-test\n"
	if err := os.WriteFile(filepath.Join(configPath, ".env"), []byte(envContent), 0o600); err != nil {
		t.Fatal(err)
	}

	// Mock all APIs to return 200
	allOK := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"login":"user","data":{"name":"User"}}`)
	}))
	defer allOK.Close()

	origGitHub := githubAPIBaseURL
	origOpenAI := openAIAPIBaseURL
	origAsana := asanaAPIBaseURL
	origClient := defaultHTTPClient
	githubAPIBaseURL = allOK.URL
	openAIAPIBaseURL = allOK.URL
	asanaAPIBaseURL = allOK.URL
	defaultHTTPClient = &http.Client{}
	t.Cleanup(func() {
		githubAPIBaseURL = origGitHub
		openAIAPIBaseURL = origOpenAI
		asanaAPIBaseURL = origAsana
		defaultHTTPClient = origClient
	})

	origArgs := os.Args
	os.Args = []string{"teamhero", "doctor", "--format=json"}
	t.Cleanup(func() { os.Args = origArgs })

	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = origStdout })

	runDoctor()

	w.Close()
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	var result DoctorResult
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatalf("failed to parse JSON output: %v\nOutput: %s", err, output)
	}

	// Collect all check names
	checkNames := map[string]bool{}
	for _, c := range result.Checks {
		checkNames[c.Name] = true
	}

	// Verify expected check names are present
	expectedNames := []string{
		"config_file",
		"env_file",
		"env_permissions",
		"github_token",
		"github_org",
		"openai_key",
		"asana_token",
		"google_drive",
		"output_directory",
	}
	for _, name := range expectedNames {
		if !checkNames[name] {
			t.Errorf("expected check name %q to be present in doctor output, got names: %v", name, checkNames)
		}
	}
}

// TestDoctorRunDoctor_VersionFieldSet verifies the version field is populated.
func TestDoctorRunDoctor_VersionFieldSet(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	configPath := filepath.Join(tmpDir, "teamhero")
	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatal(err)
	}

	// Unreachable APIs to avoid network calls — we just want JSON structure
	origGitHub := githubAPIBaseURL
	origOpenAI := openAIAPIBaseURL
	origAsana := asanaAPIBaseURL
	origClient := defaultHTTPClient
	githubAPIBaseURL = "http://127.0.0.1:1"
	openAIAPIBaseURL = "http://127.0.0.1:1"
	asanaAPIBaseURL = "http://127.0.0.1:1"
	defaultHTTPClient = &http.Client{}
	t.Cleanup(func() {
		githubAPIBaseURL = origGitHub
		openAIAPIBaseURL = origOpenAI
		asanaAPIBaseURL = origAsana
		defaultHTTPClient = origClient
	})

	origArgs := os.Args
	os.Args = []string{"teamhero", "doctor", "--format=json"}
	t.Cleanup(func() { os.Args = origArgs })

	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = origStdout })

	runDoctor()

	w.Close()
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	var result DoctorResult
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatalf("failed to parse JSON output: %v\nOutput: %s", err, output)
	}

	// version var is "dev" in test builds
	if result.Version == "" {
		t.Error("expected Version to be non-empty")
	}
}

// ===========================================================================
// runDoctor: human-readable output path (lines 112-140)
// ===========================================================================

func TestRunDoctor_HumanReadable(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Redirect stdout to capture the human-readable output
	r, w, _ := os.Pipe()
	origStdout := os.Stdout
	os.Stdout = w

	// flagFormat is "" by default → not json mode → human-readable path
	old := *flagFormat
	*flagFormat = ""
	defer func() { *flagFormat = old }()

	result := runDoctor()

	w.Close()
	os.Stdout = origStdout
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	// The human-readable output goes to stdout (fmt.Println)
	// Result is 0 (healthy) or 1 (unhealthy) - either is fine
	if result != 0 && result != 1 {
		t.Errorf("expected runDoctor to return 0 or 1, got %d", result)
	}
	_ = output // just verify it doesn't panic
}

func TestRunDoctor_FormatArg(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmpDir)

	// Test with --format=json arg to cover os.Args check path
	// Note: we can't easily manipulate os.Args in a test, so just verify
	// the function runs without panic when flagFormat = "json"
	old := *flagFormat
	*flagFormat = "json"
	defer func() { *flagFormat = old }()

	r, w, _ := os.Pipe()
	origStdout := os.Stdout
	os.Stdout = w

	result := runDoctor()

	w.Close()
	os.Stdout = origStdout
	buf := make([]byte, 64*1024)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if result != 0 && result != 1 {
		t.Errorf("expected runDoctor to return 0 or 1, got %d", result)
	}
	if !strings.Contains(output, "healthy") {
		t.Errorf("expected JSON output to contain 'healthy', got: %s", output)
	}
}
