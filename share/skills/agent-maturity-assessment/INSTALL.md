# Installing the Agent Maturity Assessment skill

This skill is **harness-agnostic** — it works in any Claude environment that supports the Anthropic Skills convention (a directory with a `SKILL.md` + optional `references/`). Drop it in, and Claude can run a 12-criterion maturity audit on demand.

## What's in the bundle

```
agent-maturity-assessment/
├── SKILL.md                            ← entry point with frontmatter
├── INSTALL.md                          ← this file (delete after install)
└── references/
    ├── criteria.md                     ← 12-criterion rubric (full text)
    ├── interview.md                    ← 7 Phase-1 questions + Q→criterion mapping
    ├── output-template.md              ← canonical audit template
    └── preflight.md                    ← evidence tiers + multi-repo handling
```

The skill works in two modes:
- **Pure-Claude** (default): Claude reads the references on demand, uses `AskUserQuestion` for the Phase-1 interview, writes the audit by hand. Works everywhere.
- **Team Hero binary** (optional accelerator): if `teamhero` is installed and `OPENAI_API_KEY` is configured, the skill calls `teamhero assess` to run the whole pipeline automatically.

You don't have to install Team Hero — the skill is fully functional in pure-Claude mode.

---

## Claude Code

Skills live in `~/.claude/skills/<skill-name>/`. Drop the bundle in:

```bash
mkdir -p ~/.claude/skills
cp -r path/to/agent-maturity-assessment ~/.claude/skills/
rm ~/.claude/skills/agent-maturity-assessment/INSTALL.md   # not needed at runtime
```

Restart Claude Code (or run `/skills reload` if your installation supports it). Test:

```
You: audit this repo's agent readiness
```

Claude should pick up the skill from its `description` (the trigger phrases include "agent readiness", "AI maturity", "audit the team", "score this repo", etc.).

### From a Claude Code plugin

If you'd rather ship the skill as part of a plugin, put it under `<plugin>/skills/agent-maturity-assessment/` and add the plugin to your `~/.claude/plugins/` directory (or via `claude plugin install`). The structure inside `skills/` is identical.

---

## Cowork / Anthropic Workbench

In Cowork sessions, skills load from the workspace skills directory. Upload the `agent-maturity-assessment/` folder via the skills UI, or commit it to a repo Cowork has access to.

Trigger phrases work the same — the `description` frontmatter is what the runtime matches against.

---

## Custom Claude harness (Anthropic SDK)

If you're embedding Claude via the Anthropic SDK and using the [Managed Agents SDK](https://docs.anthropic.com) or rolling your own skill loader, point your loader at the directory.

For raw API + skills: include the `SKILL.md` body as part of the system prompt (or as a tool-result message), and either inline the references or expose them via a file-reading tool the model can call.

---

## Verifying the install

Ask Claude something the skill should trigger on:

> "Can you run an agent maturity assessment on this repo?"
> "How healthy is this engineering org?"
> "Score this codebase for AI readiness."

You should see Claude:
1. Read `SKILL.md` and one or more `references/` files
2. Run a preflight probe (looking for `gh` CLI, GitHub MCP, or git-only)
3. Ask the 7 Phase-1 questions **one at a time** (this is a hard checkpoint — if it dumps all 7 in one message, the skill isn't loading correctly)
4. Gather evidence per criterion
5. Write the audit using the template

If Claude doesn't pick up the skill, the most common cause is that the harness isn't loading skills from your install location. Check the harness's skill-loading docs.

---

## Optional: Team Hero binary accelerator

[Team Hero](https://github.com/asabaylus/teamhero.cli) is a CLI that automates the assessment pipeline end-to-end (preflight → adjacent-repo detection → interview → 12 deterministic evidence collectors → AI scoring → audit writer). The skill detects whether the binary is available and uses it when present:

```bash
# Install
brew install asabaylus/teamhero/teamhero    # or download from releases

# Configure credentials (one-time)
teamhero setup

# Then trigger the skill normally — it'll call `teamhero assess` under the hood
```

The binary is a **strict superset** of pure-Claude mode: same rubric, same interview wording, same output template, same preflight tiers. You can run `teamhero assess` directly without invoking the skill at all.

---

## Customizing

- **Trigger phrases** — edit the `description` field in `SKILL.md`'s frontmatter to add or remove trigger words.
- **Rubric** — fork the skill and edit `references/criteria.md`. If you change scoring math (weights, max), update `SKILL.md`'s *Scoring* section to match.
- **Interview questions** — edit `references/interview.md`. Keep the one-question-at-a-time rule — that's what produces useful answers vs. a hollow audit.

Track your changes in a `CHANGELOG.md` next to `SKILL.md` so historical audit scores stay interpretable.

---

## License & attribution

The rubric, interview wording, and output template are derived from the upstream Agent Maturity Assessment skill. Redistribute freely with attribution to the original.
