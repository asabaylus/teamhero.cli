package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// TeamInfo represents a GitHub team returned by the discovery service.
type TeamInfo struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

const githubAPIRoot = "https://api.github.com"

// httpClient is used for all GitHub API requests and can be overridden in tests.
var httpClient = &http.Client{}

// githubGet performs a paginated GET against the GitHub REST API and
// accumulates all pages into a flat JSON array returned as raw bytes.
func githubGet(token, path string, params url.Values) ([]json.RawMessage, error) {
	var all []json.RawMessage
	page := 1
	for {
		u, err := url.Parse(githubAPIRoot + path)
		if err != nil {
			return nil, err
		}
		q := u.Query()
		for k, vs := range params {
			for _, v := range vs {
				q.Set(k, v)
			}
		}
		q.Set("per_page", "100")
		q.Set("page", strconv.Itoa(page))
		u.RawQuery = q.Encode()

		req, err := http.NewRequest(http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "token "+token)
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

		resp, err := httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			// Try to surface GitHub's error message.
			var ghErr struct {
				Message string `json:"message"`
			}
			_ = json.Unmarshal(body, &ghErr)
			if ghErr.Message != "" {
				return nil, fmt.Errorf("GitHub API error (HTTP %d): %s", resp.StatusCode, ghErr.Message)
			}
			return nil, fmt.Errorf("GitHub API returned HTTP %d for %s", resp.StatusCode, u.String())
		}

		var batch []json.RawMessage
		if err := json.Unmarshal(body, &batch); err != nil {
			return nil, fmt.Errorf("failed to parse GitHub response: %w", err)
		}
		all = append(all, batch...)
		if len(batch) < 100 {
			break
		}
		page++
	}
	return all, nil
}

// DiscoverRepos fetches available repository full-names for an organization.
func DiscoverRepos(org string, includePrivate, includeArchived bool) ([]string, error) {
	token := loadGitHubToken()
	if token == "" {
		return nil, fmt.Errorf("GITHUB_PERSONAL_ACCESS_TOKEN not set; run `teamhero setup` to configure credentials")
	}

	params := url.Values{"type": {"all"}}
	items, err := githubGet(token, "/orgs/"+org+"/repos", params)
	if err != nil {
		return nil, fmt.Errorf("failed to discover repos: %w", err)
	}

	var repos []string
	for _, raw := range items {
		var r struct {
			FullName   string `json:"full_name"`
			Archived   bool   `json:"archived"`
			IsTemplate bool   `json:"is_template"`
			Private    bool   `json:"private"`
		}
		if err := json.Unmarshal(raw, &r); err != nil {
			continue
		}
		if r.Archived && !includeArchived {
			continue
		}
		if r.Private && !includePrivate {
			continue
		}
		if r.IsTemplate {
			continue
		}
		// Return short name only ("repo"), not full name ("org/repo"),
		// to match the behaviour of the original discover.ts script.
		shortName := r.FullName
		if idx := strings.LastIndex(shortName, "/"); idx >= 0 {
			shortName = shortName[idx+1:]
		}
		repos = append(repos, shortName)
	}
	return repos, nil
}

// DiscoverTeams fetches available teams for an organization.
func DiscoverTeams(org string) ([]TeamInfo, error) {
	token := loadGitHubToken()
	if token == "" {
		return nil, fmt.Errorf("GITHUB_PERSONAL_ACCESS_TOKEN not set; run `teamhero setup` to configure credentials")
	}

	items, err := githubGet(token, "/orgs/"+org+"/teams", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to discover teams: %w", err)
	}

	var teams []TeamInfo
	for _, raw := range items {
		var t struct {
			Name string `json:"name"`
			Slug string `json:"slug"`
		}
		if err := json.Unmarshal(raw, &t); err != nil {
			continue
		}
		if t.Slug == "" {
			continue
		}
		teams = append(teams, TeamInfo{Name: t.Name, Slug: t.Slug})
	}
	return teams, nil
}

// DiscoverMembers fetches available member logins for an organization.
func DiscoverMembers(org string) ([]string, error) {
	token := loadGitHubToken()
	if token == "" {
		return nil, fmt.Errorf("GITHUB_PERSONAL_ACCESS_TOKEN not set; run `teamhero setup` to configure credentials")
	}

	params := url.Values{"role": {"all"}}
	items, err := githubGet(token, "/orgs/"+org+"/members", params)
	if err != nil {
		return nil, fmt.Errorf("failed to discover members: %w", err)
	}

	var logins []string
	for _, raw := range items {
		var m struct {
			Login string `json:"login"`
		}
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		if m.Login != "" {
			logins = append(logins, m.Login)
		}
	}
	return logins, nil
}
