# Configuration Reference

TeamHero has two configuration files, both managed automatically:

| File | What it stores | How it's created |
|------|---------------|-----------------|
| `~/.config/teamhero/.env` | API credentials (GitHub, OpenAI, Asana) | `teamhero setup` |
| `~/.config/teamhero/config.json` | Report preferences (org, members, sections, dates) | Saved after each interactive report run |

You rarely need to edit these by hand. `teamhero setup` handles credentials, and your choices during interactive runs are saved for next time. This document is a reference for when you need to fine-tune something.

---

## Report settings (`config.json`)

### Minimal example

Most users only need an org and members:

```json
{
  "org": "my-org",
  "members": ["alice", "bob"],
  "sections": {
    "dataSources": { "git": true, "asana": false },
    "reportSections": { "individualContributions": true }
  }
}
```

### Full example

```json
{
  "org": "my-org",
  "team": "backend",
  "members": ["alice", "bob", "charlie"],
  "repos": ["api", "web"],
  "useAllRepos": false,
  "since": "2026-03-01",
  "until": "2026-03-14",
  "includeBots": false,
  "excludePrivate": false,
  "includeArchived": false,
  "detailed": true,
  "maxCommitPages": 10,
  "maxPrPages": 5,
  "sequential": false,
  "discrepancyThreshold": 30,
  "template": "detailed",
  "sections": {
    "dataSources": {
      "git": true,
      "asana": true
    },
    "reportSections": {
      "visibleWins": true,
      "individualContributions": true,
      "discrepancyLog": true,
      "loc": true
    }
  }
}
```

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `org` | string | *(required)* | GitHub organization name |
| `team` | string | — | GitHub team slug (filters members) |
| `members` | string[] | — | Explicit list of GitHub logins to include |
| `repos` | string[] | — | Specific repos to analyze (empty = all) |
| `useAllRepos` | boolean | `true` | When true, analyze all repos in the org |
| `since` | string | 7 days ago | Start date (`YYYY-MM-DD`) |
| `until` | string | today | End date (`YYYY-MM-DD`) |
| `includeBots` | boolean | `false` | Include bot accounts in the report |
| `excludePrivate` | boolean | `false` | Exclude private repositories |
| `includeArchived` | boolean | `false` | Include archived repositories |
| `detailed` | boolean | `false` | Include detailed PR/commit listings |
| `maxCommitPages` | number | — | Max pages of commits to fetch (0 = no limit) |
| `maxPrPages` | number | — | Max pages of PRs to fetch (0 = no limit) |
| `sequential` | boolean | `false` | Run API requests one at a time instead of in parallel |
| `discrepancyThreshold` | number | `30` | Confidence threshold (0-100) for discrepancy items to appear in the report |
| `template` | string | — | Report template: `"detailed"`, `"executive"`, or `"individual"` |

### Data sources (`sections.dataSources`)

Controls which external APIs are called during report generation.

| Field | Default | Description |
|-------|---------|-------------|
| `git` | `true` | Fetch from GitHub (commits, PRs, reviews) |
| `asana` | `true` | Fetch task data from Asana |

### Report sections (`sections.reportSections`)

Controls which sections appear in the final report. These are independent of data sources — for example, `loc` triggers GitHub API calls automatically even if you haven't explicitly enabled the `git` data source.

| Field | Default | Description |
|-------|---------|-------------|
| `visibleWins` | `false` | AI-extracted highlights of notable contributions |
| `individualContributions` | `true` | Per-member breakdown of activity |
| `discrepancyLog` | `false` | Cross-source discrepancy analysis (finds conflicts between GitHub and Asana) |
| `loc` | `false` | Lines-of-code additions/deletions per member |

### CLI-only flags (not saved)

These are passed on the command line and not persisted:

| Flag | Description |
|------|-------------|
| `--flush-cache all\|loc\|metrics` | Invalidate cached data before running |
| `--output /path/to/report.md` | Custom output file path |
| `--output-format markdown\|json\|both` | Output format |

### How settings are merged

In headless mode, settings are merged in this order (later wins):

1. Built-in defaults
2. `~/.config/teamhero/config.json` (saved from last interactive run)
3. Environment variables (`TEAMHERO_SEQUENTIAL`, `TEAMHERO_DISCREPANCY_CONFIDENCE_THRESHOLD`)
4. CLI flags (`--org`, `--since`, `--sections`, etc.)

---

## Credentials (`.env`)

Managed by `teamhero setup`. Stored at `~/.config/teamhero/.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Yes | GitHub PAT with org read access |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI summaries |
| `ASANA_API_TOKEN` | No | Asana personal access token |
| `ASANA_WORKSPACE_GID` | No | Asana workspace ID(s), comma-separated |
| `ASANA_DEFAULT_EMAIL_DOMAIN` | No | Fallback domain for GitHub-to-Asana email matching |
| `USER_MAP` | No | JSON mapping GitHub logins to Asana identities (see below) |
| `AI_MODEL` | No | OpenAI model override (default: `gpt-5-mini`) |
| `OPENAI_SERVICE_TIER` | No | `"flex"` for reduced-cost batch processing |

---

## Matching GitHub users to Asana (`USER_MAP`)

When Asana is enabled, TeamHero automatically matches GitHub users to Asana accounts by email and display name. If your report shows "No match found" for a team member, you probably need a `USER_MAP` entry.

### When automatic matching works

- GitHub login `john.doe` + `ASANA_DEFAULT_EMAIL_DOMAIN=company.com` matches Asana user `john.doe@company.com`
- GitHub display name "Jane Smith" matches Asana display name "Jane Smith"

### When you need `USER_MAP`

- GitHub username doesn't match the email (e.g., `jsmith` vs `jane.smith@company.com`)
- Display names differ between GitHub and Asana
- A user belongs to multiple Asana workspaces
- You want to map directly by Asana user ID

### Example

`USER_MAP` is a JSON string set in `~/.config/teamhero/.env`:

```bash
USER_MAP='{
  "alice": {
    "name": "Alice Johnson",
    "email": "alice.johnson@company.com",
    "github": { "login": "alicej" },
    "asana": { "userGid": "111222333", "workspaceGid": "987654321" }
  },
  "bob": {
    "name": "Bob Williams",
    "email": "bob@company.com",
    "github": { "login": "bobwilliams" },
    "asana": {}
  }
}'
```

Use **single quotes** around the JSON value to avoid shell escaping issues.

### Fields

| Field | Description |
|-------|-------------|
| `name` | Display name (shared across systems) |
| `email` | Email address (shared across systems) |
| `github.login` | GitHub username |
| `asana.userGid` | Direct Asana user ID (highest-priority match) |
| `asana.workspaceGid` | Asana workspace ID (for users in multiple workspaces) |
| `asana.email` | Asana-specific email (overrides shared `email`) |
| `asana.name` | Asana-specific display name (overrides shared `name`) |

If the `asana` section is empty (`{}`), matching falls back to the shared `email` and `name` fields.
