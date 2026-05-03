# TeamHero

**Stop spending Friday night writing status reports.**

TeamHero connects to your GitHub, Asana, and meeting transcripts, reconciles the data, flags discrepancies, and writes a defensible engineering report in about 5 minutes for ~$0.02.

```
$ teamhero report

  Fetching GitHub activity for 12 contributors...
  Reading Asana sprint board...
  Reconciling data sources...
  ⚠  Discrepancy: PR #847 merged Wed — ticket TKT-291 still "In Progress"
  Generating report... done in 4m 38s

  ✓ Report saved: teamhero-report-my-org-2026-03-14.md
```

The output is a Markdown report with delivery summaries, per-engineer breakdowns, AI-generated highlights, lines-of-code stats, and a discrepancy log that catches conflicts between your data sources before your boss does.

**Integrates with:** GitHub, Asana, Google Meet transcripts | **Coming soon:** Jira, Linear

---

## Install

### macOS / Linux (Homebrew)

```bash
brew install asabaylus/teamhero/teamhero
```

### Linux (APT / Debian / Ubuntu)

```bash
curl -fsSL https://apt.teamhero.dev/teamhero.gpg | sudo gpg --dearmor -o /usr/share/keyrings/teamhero.gpg
echo "deb [signed-by=/usr/share/keyrings/teamhero.gpg] https://apt.teamhero.dev stable main" \
  | sudo tee /etc/apt/sources.list.d/teamhero.list
sudo apt-get update && sudo apt-get install teamhero
```

### Any platform (curl)

```bash
curl -fsSL https://github.com/asabaylus/teamhero.cli/releases/latest/download/install.sh | bash
```

Downloads the latest release to `~/.local/bin`. Pass `--version v1.2.3` for a specific version or `--install-dir /usr/local/bin` to change the install location.

> **Supported platforms:** macOS (Intel + Apple Silicon), Linux (x86_64 + ARM64). Windows is supported under WSL.

---

## Quick Start

### 1. Configure credentials

```bash
teamhero setup        # Guided credential wizard
teamhero doctor       # Verify everything is working
```

You'll need:

- **GitHub Personal Access Token** — [create a fine-grained PAT](https://github.com/settings/personal-access-tokens/new) with **Contents** (read), **Metadata** (read), **Pull requests** (read), **Members** (read, org-level)
- **OpenAI API Key** — for AI-powered summaries and highlights
- **Asana API Token** *(optional)* — for Asana task enrichment
- **Google Drive** *(optional)* — for meeting transcripts; connected via OAuth during `teamhero setup`

### 2. Generate a report

```bash
teamhero report
```

The interactive TUI walks you through selecting an org, repos, team members, date range, and report sections. When it finishes, it writes a Markdown file to the current directory.

### 3. Automate it

Once you've run interactively, your settings are saved. Future reports can be headless:

```bash
teamhero report --headless --no-confirm
```

Or override specific options:

```bash
teamhero report --headless --since 2026-03-01 --until 2026-03-14 --sections loc,individual
```

Run `teamhero report --help` for all flags.

---

## Use with Claude Code

Install TeamHero using any method above, then ask Claude to configure it:

```
You: Install and configure TeamHero for my GitHub org "my-org"
```

Claude will run `teamhero setup` to walk through credential configuration, then `teamhero doctor` to verify. You'll be prompted to paste each credential as Claude drives the setup wizard.

Once configured, ask Claude to generate reports:

```
You: Generate a TeamHero report for the last two weeks
```

---

## Configuration

Credentials are stored at `~/.config/teamhero/.env`. Report settings are saved to `~/.config/teamhero/config.json` after each interactive run and automatically reused in headless mode.

See [Configuration Reference](docs/CONFIG_FORMAT.md) for all options, including cross-system user mapping (GitHub/Asana) and AI model configuration.

### Reduce AI costs

Enable OpenAI's **flex tier** for cheaper (but slower) report generation:

```bash
teamhero setup          # Select "OpenAI Service Tier" → flex
```

Or set `OPENAI_SERVICE_TIER=flex` in `~/.config/teamhero/.env`.

---

## Run a maturity assessment

Score an engineering organization (or a single repo) against the 12-criterion
**Agent Maturity Assessment** — reproducible dev environments, integration
cadence, testability, observability, design discipline, deep modules,
repo-local agent context, sanctioned AI tooling, human review, evals,
blast-radius controls, and judgment under AI augmentation.

The audit produces a weighted percentage, a raw `/12` score, item-level
evidence sentences, the top-3 fixes, and strengths to preserve. Output lands
in the current directory as `teamhero-maturity-<scope>-<date>.md` plus a
JSON sidecar with the full data.

**Bands:** **Excellent** (90%+) · **Healthy** (75–89%) · **Functional but
slow** (60–74%) · **Significant dysfunction** (40–59%) · **Triage** (<40%).

### Interactive TUI

```bash
teamhero assess
```

The wizard asks for scope (local repo / GitHub org / both), then walks you
through the 7 Phase-1 interview questions one at a time (AI tooling, hiring,
DORA visibility, design discipline, evals, blast-radius red-teaming, adjacent
repos). Each question has a small set of pre-written answer options plus a
free-text "Other" choice; "I don't know" maps the linked criterion to `n/a`.

### Headless / scripted

```bash
# Audit the current repo (no interview — uses CONFIG.md or "unknown")
teamhero assess --headless --path .

# Audit with pre-supplied interview answers
teamhero assess --headless --path . \
  --interview-answers ./answers.json

# Org-wide audit
teamhero assess --headless --target-org acme \
  --interview-answers ./answers.json

# Smoke test without an OpenAI call (placeholder scores)
teamhero assess --headless --path . --dry-run
```

`answers.json` shape — keys map to question IDs, value is verbatim text or
`"unknown"`:

```json
{
  "q1": "Company-paid Claude with policy",
  "q2": "AI allowed; interviewers trained",
  "q3": "DORA via Grafana",
  "q4": "Consistent ADR step before agent code",
  "q5": "LLMs in dev loop, retro-tracked",
  "q6": "unknown",
  "q7": "No"
}
```

### Useful flags

| Flag | Purpose |
|------|---------|
| `--scope-mode {org\|local-repo\|both}` | Override scope (auto-inferred from other flags) |
| `--evidence-tier {auto\|gh\|github-mcp\|git-only}` | Pin the evidence tier; default auto-detects |
| `--audit-output <path>` | Override the markdown output path |
| `--audit-output-format {markdown\|json\|both}` | Default: `both` |
| `--dry-run` | Skip the AI scorer; emit a placeholder audit |
| `--show-assess-config` | Print saved configuration as JSON and exit |

Run `teamhero assess --help` for the full list.

### How the score is built

1. **Preflight** — auto-detects evidence tier (`gh` CLI authed → Tier 1,
   GitHub MCP available → Tier 2, otherwise → Tier 3 git+filesystem only).
2. **Adjacent repos** — scans the local repo for workflow `uses:`, Terraform
   module sources, submodules, and README cross-refs to find sibling repos
   that should be in scope.
3. **Interview** — captures the 7 Phase-1 answers (interactively, from
   `--interview-answers`, or from `docs/audits/CONFIG.md` if it exists in
   the repo). Persists the confirmed answers back to `CONFIG.md` after
   every successful run so re-audits can confirm-or-refresh.
4. **Evidence** — 12 deterministic detectors run against the local repo
   (test files, CI workflows, dependency manifests, ADRs, agent context
   files, CODEOWNERS, OIDC vs. long-lived secrets, Terraform IaC, etc.).
5. **AI scoring** — OpenAI Responses API with a strict JSON schema returns
   per-item scores, ≤25-word evidence sentences, top-3 fixes, and
   strengths. Tier-3 audits cap items 2/3/9/11 at 0.5 because the
   GitHub-side evidence isn't observable.
6. **Output** — markdown rendered against the canonical template +
   matching `.json` with the full artifact (rubric version, evidence
   facts, category subtotals).

---

## Learn more

- [Configuration Reference](docs/CONFIG_FORMAT.md) — all settings, credentials, and user identity mapping
- [Architecture Overview](docs/ARCHITECTURE.md) — how the system works under the hood

---

## Contributing

### Development setup

Requires [Go](https://go.dev/dl/) 1.24+, [Bun](https://bun.sh) v1.0+, Node.js 20+, and [just](https://github.com/casey/just).

```bash
just install          # Installs deps, builds CLI + TUI, links binary
just                  # List all available recipes
```

| Recipe | Description |
|--------|-------------|
| `just build-all` | Build everything (TypeScript + Go) |
| `just test-all` | Run all tests (TypeScript + Go) |
| `just lint` | Format and lint (Biome) |
| `just report` | Run a report |
| `just assess` | Run a maturity assessment |
| `just reset` | Clean all build artifacts |

### Secure credential setup with varlock

Instead of pasting API keys during `teamhero setup`, manage credentials through [varlock](https://github.com/nicholasgriffintn/varlock) and the `.env.schema` file checked into the repo:

```bash
cat .env.schema                                    # Review what's needed (no secret values)
npx varlock sync --target ~/.config/teamhero/.env  # Populate from a secrets manager
teamhero doctor                                    # Verify
```

### Claude Code Plugin

TeamHero is also available as a [Claude Code plugin](https://code.claude.com/docs/en/plugins.md) for use in Claude Code and Cowork sessions without a separate CLI install:

```bash
claude plugin marketplace add asabaylus/teamhero.cli
claude plugin install teamhero-scripts@teamhero
```

In Cowork, the plugin uses MCP connectors for GitHub and Asana (OAuth-based, no API tokens to manage).

### Further reading

- [Distribution & Release Process](docs/DISTRIBUTION.md)
- [Infrastructure Setup](docs/INFRASTRUCTURE_SETUP.md)
- [Agent Onboarding](AGENTS.md)
