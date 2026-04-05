# Generate TeamHero Report

Generate a developer contribution report for a GitHub organization.

## Detect Runtime Mode

Check which MCP tools are available to determine the runtime path:

1. **MCP mode** — If you have access to ~~version control tools (e.g., `SearchRepositories`, `ListCommits`, `ListPullRequests`) and optionally ~~project tracker tools (e.g., `asana_search_tasks`, `search_issues`), use Path A below. This is the preferred path in Co-Work and other MCP-enabled environments.
2. **Binary mode** — Otherwise, fall back to Path B (install and run the TeamHero binaries).

**Detection heuristic:** Look for any MCP tools that can search repositories and list commits/PRs. The exact tool name prefixes vary by environment (e.g., `mcp__github__SearchRepositories` in Claude Code, `SearchRepositories` in Co-Work). Match by function, not exact name.

---

## Path A — MCP Connector Mode (No Binary Required)

When ~~version control and ~~project tracker MCP connectors are available, compose the report directly. No binaries, no credentials, no network egress configuration needed — the MCP connectors handle authentication via OAuth.

### Step 1: Gather parameters

Ask the user for:
- **GitHub org** name (required)
- **Date range** — default: last 7 days (`--since` / `--until`)
- **Project tracker workspace or project** — if ~~project tracker connector is available

### Step 2: Fetch GitHub data

Use ~~version control MCP tools to collect:

1. **Org members** — Use `GetTeams` → `GetTeamMembers` for each team to build the member list. Alternatively, use `SearchUsers` with `org:<orgname>` qualifier. Note: there is no `ListOrgMembers` tool — these are the workarounds.
2. **Repositories** — Use `SearchRepositories` with `org:<orgname>` to find active repos.
3. **Commits** — For each member, use `ListCommits` filtered by author and date range across org repos.
4. **Pull requests** — Use `SearchPullRequests` or `ListPullRequests` to find PRs authored by each member (opened, closed, merged in the window).
5. **PR details** — For merged PRs, use `PullRequestRead` or `GetPullRequest` to get additions/deletions line counts.
6. **Reviews** — For each PR in the window, list reviews to count per-member review activity.

### Step 2.5: Fetch meeting notes from file storage (if available)

If file storage MCP tools are available (e.g., Google Drive), search for meeting notes and
call transcripts in the user's Google Drive:

1. Search for the "Meet Notes" folder and list Google Docs modified
   within the reporting date range.
2. Search for the "Meet Recordings" folder for Gemini-generated
   transcripts (also Google Docs).
3. Read/export each document as plain text.
4. Extract: meeting title, date, attendees, key discussion points,
   decisions, action items.
5. Feed these notes into the Visible Wins section, cross-referencing
   discussion items against project names from the task tracker.

Ask the user which Google Drive folder to search if unclear.

### Step 3: Fetch project tracker data (if available)

Use ~~project tracker MCP tools to collect:

1. **Completed tasks** — Search for tasks completed in the date range, filtered to team members. For Asana: `asana_search_tasks` with completed date filters. For Linear/Jira: equivalent search by completion date.
2. **Project groupings** — Group tasks by their parent project/section for the "Visible Wins" section. For Asana: `asana_get_projects_for_workspace` and `asana_get_project`. For others: equivalent project/board lookup.
3. **Task-PR links** — Extract GitHub PR URLs from task descriptions or custom fields for discrepancy detection.
4. **Workspace discovery** — If needed, use `asana_list_workspaces` or equivalent to find the target workspace, then `asana_get_workspace_users` to cross-reference members.

If no ~~project tracker MCP tools are available, skip this step. The report will omit the "Visible Wins" section grouping by project and the "Discrepancy Log" section.

### Step 4: Compose the report

Follow the format in `REPORT-FORMAT.md` (in this skill directory) exactly. Use Claude's own capabilities to:

- Synthesize commit and PR data into narrative individual updates
- Group delivered outcomes by project (or by repository if no project tracker)
- Build the at-a-glance summary table from raw PR/commit counts
- Cross-reference project tracker "Done" tasks against open PRs for the discrepancy log

### Step 5: Write the report

Save the report to the current directory as `teamhero-report-<org>-<date>.md` where `<date>` is the end date of the range (YYYY-MM-DD format).

---

## Path B — Binary Mode (CLI Fallback)

When MCP connectors are not available, install and run the TeamHero binaries.

### Install

Check if TeamHero is already installed:

```bash
teamhero-tui --version 2>/dev/null || teamhero --version 2>/dev/null
```

If not found, install both binaries (`teamhero-tui` and `teamhero-service`):

#### Step 1: Install teamhero-tui (bundled with this plugin)

The TUI binary is bundled in this plugin's `bin/` directory:

```bash
PLUGIN_BIN="$(find ~/.claude/plugins/cache/teamhero -name teamhero-tui -type f 2>/dev/null | head -1)"
if [ -n "$PLUGIN_BIN" ]; then
  mkdir -p ~/.local/bin
  cp "$PLUGIN_BIN" ~/.local/bin/teamhero-tui
  chmod +x ~/.local/bin/teamhero-tui
  export PATH="$HOME/.local/bin:$PATH"
fi
```

#### Step 2: Install teamhero-service (download from GitHub release)

The service binary is too large to bundle (~100MB). Download the platform archive from the latest release (it contains both binaries):

```bash
curl -sL "https://github.com/asabaylus/teamhero.scripts/releases/latest/download/teamhero-$(curl -sI https://github.com/asabaylus/teamhero.scripts/releases/latest | grep -i location | sed 's|.*/v||;s/\r//')-linux-amd64.tar.gz" \
  | tar xz -C ~/.local/bin --strip-components=1
chmod +x ~/.local/bin/teamhero-tui ~/.local/bin/teamhero-service
```

If no release is available yet, build from source (requires Bun):

```bash
git clone https://github.com/asabaylus/teamhero.scripts.git /tmp/teamhero
cd /tmp/teamhero && bun install && bun build --compile --minify --outfile ~/.local/bin/teamhero-service scripts/run-report.ts
```

#### Alternative: Homebrew (installs both binaries)

```bash
brew tap asabaylus/teamhero https://github.com/asabaylus/teamhero.scripts
brew install teamhero
```

### Configure

TeamHero needs credentials. Check if they exist:

```bash
teamhero-tui doctor
```

If credentials are missing, write them to `~/.config/teamhero/.env`:

```bash
mkdir -p ~/.config/teamhero
cat > ~/.config/teamhero/.env << 'ENVEOF'
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx
OPENAI_API_KEY=sk-xxx
ASANA_API_TOKEN=xxx
ENVEOF
chmod 600 ~/.config/teamhero/.env
```

Ask the user for their actual token values — do not guess or fabricate credentials.

### Network Requirements

Binary mode makes outbound API calls to GitHub, OpenAI, and (optionally) Asana.

**Required domains for network egress allowlists** (e.g., sandboxed environments):

| Domain | Purpose |
|--------|---------|
| `api.github.com` | Pull requests, commits, reviews |
| `api.openai.com` | AI-generated summaries |
| `app.asana.com` | Asana task data (optional) |

If running in a sandboxed environment, the user must enable network egress and allowlist these domains. If `curl -s https://api.github.com/zen` fails, tell the user:

> TeamHero needs outbound network access. Add `api.github.com`, `api.openai.com`, and `app.asana.com` to the domain allowlist. Alternatively, run from your local terminal: `teamhero-tui report --headless`

### Run a report

#### Discover saved configuration

Previous interactive runs save settings to `~/.config/teamhero/config.json`.
Inspect it before running:

```bash
teamhero-tui report --show-config
```

#### Run with saved config

Headless mode loads saved config automatically — no flags needed if config exists:

```bash
teamhero-tui report --headless
```

#### Override dates or scope

```bash
# Custom date range
teamhero-tui report --headless --since {{since}} --until {{until}}

# Different org or members
teamhero-tui report --headless --org {{org}} --members {{members}}

# Narrow data sources
teamhero-tui report --headless --sources git,loc --sections individual
```

#### Full flag reference

Run `teamhero-tui report --help` for all available flags.

### Output

Reports are written to the current directory as `teamhero-report-<org>-<date>.md`.
The output path is printed to stdout for machine consumption.

Use `--output-format json` for structured JSON or `--output-format both` for both formats.
