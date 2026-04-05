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
