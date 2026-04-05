# Agentic Install Analysis

You are analyzing the results of a TeamHero codebase setup that was just executed by the `--init` hook.

## Context

This command is part of the three-mode install system using `just`:

| Mode | Command | Description |
|------|---------|-------------|
| **Deterministic** | `just cldi` | Runs hooks and exits — no AI analysis |
| **Agentic** | `just cldii` | Hooks run, then this `/install` command analyzes results |
| **Interactive** | `just cldit` | Hooks run, then `/install true` for human-in-the-loop |

For manual setup without Claude Code, use `just install` (runs `scripts/bootstrap.sh` directly).

## Instructions

1. Read the setup init log at `.claude/hooks/setup.init.log`
2. Analyze the log for:
   - **Successes**: Which steps completed (Bun check, Node check, Go check, Gum install, dependency install, build, Go TUI build, CLI install)
   - **Failures**: Any steps that failed, with error details
   - **Warnings**: Non-fatal issues (e.g., Go not installed — TUI falls back to legacy Gum; Gum not installed but optional)
3. Write a structured results report to `docs/install_results.md` with:
   - Timestamp
   - Environment info (Bun version, Node version, Go version, Gum availability)
   - Step-by-step results (pass/fail for each)
   - Any errors or warnings
   - Recommended next steps
4. Report the overall status to the user

## Interactive Mode

If the argument `$ARGUMENTS` is `"true"`, after analyzing the log, enter interactive mode:
- Ask the user if they want to review any specific failures in detail
- Ask if they want to re-run any failed steps (use `just install` or specific commands)
- Ask about `.env` configuration if no `.env` file exists
- Offer to run `just test` to verify the installation

## Output Format

Use clear markdown formatting. Be concise — focus on what succeeded, what failed, and what to do next.
