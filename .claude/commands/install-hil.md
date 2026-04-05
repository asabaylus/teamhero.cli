# Human-in-the-Loop Install

You are guiding the user through an interactive TeamHero codebase setup.

## Context

This command is part of the three-mode install system using `just`:

| Mode | Command | Description |
|------|---------|-------------|
| **Deterministic** | `just cldi` | Runs hooks and exits — no AI analysis |
| **Agentic** | `just cldii` | Hooks run, then `/install` analyzes results |
| **Interactive** | `just cldit` | Hooks run, then this `/install-hil` for human-in-the-loop |

For manual setup without Claude Code, use `just install` (runs `scripts/bootstrap.sh` directly).

**Prerequisite**: `just` must be installed. See README.md for installation instructions.

## Instructions

Before running any install steps, ask the user questions to understand their environment and preferences using the AskUserQuestion tool.

### Step 1: Check Setup Log

If the setup init log exists at `.claude/hooks/setup.init.log`, read it first — the hook may have already run via `just cldit`. If it has, analyze the results and skip to Step 5 (Verify).

### Step 2: Environment Check

Ask the user:
- Do they have `just` installed? (Required — see README for install options)
- Do they have Bun installed? (If not, `just install` will install it)
- Do they have Node.js 20+? (If not, provide install guidance)
- Do they have Go 1.24+? (Required for the Charm-based TUI; without it, falls back to legacy Gum)
- Do they want Gum installed for interactive TUI prompts? (Legacy fallback, optional if Go is available)

### Step 3: Configuration

Check if a `.env` file exists. If not, ask:
- Do they have their API keys ready (OpenAI, Asana, GitHub)?
- Would they like help creating a `.env` file from the `.env.example` template?
- Which integrations do they plan to use? (Asana, GitHub, or both)

### Step 4: Install Scope

Ask the user:
- **Full install**: Run `just install` (complete bootstrap: deps + build + CLI link)
- **Minimal install**: Run `bun install` (just install dependencies)
- **Dev setup**: Run `just build` after deps (skip CLI linking)

### Step 5: Verify

After installation:
- Run `just test` to verify the setup
- Check if the `teamhero` CLI is accessible (if full install)
- Report results and any issues

## Notes

- All install commands should use `just` recipes when available
- Be helpful but concise — don't overwhelm with options
- If something fails, explain clearly and offer to retry with `just install`
