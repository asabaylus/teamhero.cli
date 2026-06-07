---
name: land
description: >-
  Ship the current changes end-to-end: create a conventional-commit, push to a
  feature branch (the pre-push hook runs lint + the full test suite with coverage
  as the gate), open a PR, watch its GitHub Actions checks to green with one
  auto-fix attempt, then notify and offer to clean up the worktree. Use this
  whenever the user is done with a change and wants to commit/push/ship/land it —
  trigger on "/land", "land this", "ship it", "land these changes", "commit and
  push", "open a PR for this", "push this up", or any "we're done, get it merged"
  intent. This is the ONLY sanctioned way to commit, push, and open PRs in this
  repo — prefer it over running git/gh by hand even when the user just says
  "commit this" or "push it".
---

# /land — commit, push, PR, and watch CI to green

`/land` takes whatever is in the working tree and carries it all the way to a
green PR. The point is that a human shouldn't have to babysit the mechanical
steps between "the code is good" and "CI is passing on a PR" — but each step has
a way to go wrong silently (committing to `main`, a PR that never gets its checks
watched), so this skill makes the safe path the default.

**The test/lint gate lives in the pre-push hook, not here.** `.husky/pre-push`
already runs `bun run lint`, the TS suite *with coverage* + the coverage
threshold check, and the Go tests on every `git push`. That's the single,
authoritative gate, and it runs exactly once per push. `land` does **not** re-run
lint or tests beforehand — doing so would just run the same suite twice. Trust
the hook; if it rejects the push, that's the gate doing its job (see Phase 2).

Work through the phases in order.

## Phase 0 — Orient (always do this first)

Run these together to understand the situation before touching anything:

```bash
git status --short --branch        # what's changed, current branch, ahead/behind
git rev-parse --abbrev-ref HEAD    # current branch name
git rev-parse --show-toplevel      # repo root
git rev-parse --git-common-dir     # differs from --git-dir when inside a worktree
```

Decide three things from the output:

- **Is there anything to land?** If the tree is clean *and* there's nothing
  unpushed, say so and stop — there's nothing to do.
- **Are we on `main`?** `main` is the default branch and protected by intent —
  never commit directly to it. If on `main`, you'll create a feature branch in
  Phase 1.
- **Are we in a worktree?** If `--git-common-dir` resolves outside the worktree's
  own `.git`, you're in one (e.g. a `.claude/worktrees/*` checkout). Remember
  this for Phase 4 cleanup.

## Phase 1 — Conventional commit + branch

**Compose the commit message from the actual diff**, not from memory of what you
think changed:

```bash
git add -A
git diff --cached --stat
git diff --cached            # read enough to title it accurately
```

Use Conventional Commits: `type(scope): summary`, imperative mood, no trailing
period, summary under ~72 chars. Pick `type` from what the diff actually does:

| type       | when                                                |
|------------|-----------------------------------------------------|
| `feat`     | a new capability                                    |
| `fix`      | a bug fix                                            |
| `refactor` | behavior-preserving restructure                     |
| `test`     | tests only                                           |
| `docs`     | docs only                                            |
| `chore`    | build/tooling/deps, no src behavior change          |
| `perf`     | performance                                          |
| `ci`       | CI/workflow changes                                 |

`scope` is the area touched (e.g. `service`, `tui`, `cache`, `loc`, `ai`) — match
the scopes used in recent history (`git log --oneline -10`) so it reads
consistently. Add a short body only when the *why* isn't obvious from the title.

**End every commit message with the trailer** (this repo's convention for
agent-authored commits):

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Branching rule:**

- **On `main`:** create a new branch under the `claude/` namespace, with a short
  slug derived from the commit (e.g. `fix(service): route --script flag` →
  `claude/fix-service-route-script-flag`, or any concise `claude/<slug>`). Create
  it *before* committing: `git switch -c claude/<slug>`.
- **Already on a feature branch:** commit straight onto it — don't create a new
  one. The user is iterating on existing work.

Then commit. Use a HEREDOC so the trailer and any body survive newlines:

```bash
git commit -m "$(cat <<'EOF'
type(scope): summary

Optional body explaining the why.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Phase 2 — Push (the pre-push hook is the gate)

```bash
git push -u origin HEAD
```

**This is where the tests run.** The pre-push hook re-runs lint, the TS suite
with coverage, the coverage threshold (TS 85% lines/functions/statements, 80%
branches; Go 85% block), and the Go tests. Expect it to take a bit — that's
normal, it's the whole suite.

If the push is **rejected** by the hook, the gate caught something. Treat it like
any failure:

1. Read which check failed in the hook output.
2. Fix the cause — for a coverage shortfall, add the missing tests (repo policy
   ships tests with every non-trivial change anyway); for a lint or test
   failure, fix the code.
3. Re-stage, amend or add a commit, and push again.

Do **not** bypass with `--no-verify` — the hook *is* the gate, and skipping it
just moves the failure to CI where it's slower to diagnose.

## Phase 3 — Open the PR and watch its checks

Check whether a PR already exists for this branch (a re-landed branch will), and
only create one if not:

```bash
gh pr view --json url,number 2>/dev/null \
  || gh pr create --fill --base main
```

`--fill` seeds the title and body straight from the commit(s) — no need to
hand-write a body. The PR title inherits the Conventional Commit, which is what
the squash-merge changelog uses (see `#7`/`#8`/`#9`).

Then watch the checks — but **don't block the session on it.** A full CI run
takes minutes, and `gh pr checks --watch` blocks until it finishes; running it in
the foreground freezes the conversation the whole time. Launch it as a
**background** task so the user stays free to do other things, and let the
harness re-engage you when it exits:

```bash
gh pr checks --watch --interval 30      # run this in the background
```

`--watch` blocks until every check completes and exits non-zero if any fail, so
its exit status is the signal. If it reports "no checks reported yet" right after
pushing, wait a few seconds for Actions to register, then start the watch.

**Notify on completion — actively, not just in chat.** The user has likely tabbed
away during the wait, so a passive line in the transcript is easy to miss. Fire a
real notification when the watch resolves (best-effort; fall back gracefully):

```bash
# green:
command -v notify-send >/dev/null && notify-send "✅ /land: CI green" "$(gh pr view --json url -q .url)" \
  || printf '\a✅ CI green — %s\n' "$(gh pr view --json url -q .url)"
```

Use a ❌ variant on failure. If the `PushNotification` tool is available, prefer
it — it reaches the user even outside the terminal.

### If CI fails — one fix attempt, then stop

The user opted into a single auto-fix attempt. Do exactly one:

1. Find the failing job and read its log:
   ```bash
   gh run list --branch "$(git branch --show-current)" --limit 1
   gh run view <run-id> --log-failed
   ```
2. Diagnose the *actual* failure (don't guess — CI can fail for reasons that the
   pre-push hook won't catch: frozen-lockfile installs, the pinned Go version,
   environment differences). Fix it.
3. Commit the fix and push (the pre-push hook re-gates it automatically).
4. Re-watch once with `gh pr checks --watch`.

If it fails a **second** time, stop. Report which job failed, paste the relevant
log lines, and hand it back to the user with your best read on the cause. Don't
loop — a second failure usually means something needs a human decision.

## Phase 4 — Notify and offer cleanup

When checks are green:

- **Tell the user it landed.** Include the PR URL, the branch, and a one-line
  summary of what shipped. This is the "task complete" signal.
- **Worktree cleanup (prompt first — never silent):** if Phase 0 found you're in
  a worktree, offer to remove it, but confirm before doing anything destructive,
  and note the constraint that **you cannot remove the worktree you're currently
  standing in** — that has to happen from the main checkout after the PR merges:

  ```bash
  # from the main repo root, after the PR is merged:
  git worktree remove <path>      # add --force only if the user confirms dirty removal
  git worktree prune              # clears the stale 'prunable' entries
  ```

  If the PR isn't merged yet, don't remove anything — say the worktree will be
  safe to remove once merged, and offer to do it then.

## Guardrails (the stuff that bites)

- **Never commit to `main`.** If you find yourself about to, branch first.
- **Never `git push --no-verify`** — the pre-push hook is the test/lint/coverage
  gate; skipping it defeats the whole point of `land`.
- **Don't re-run lint or tests inside `land`.** The pre-push hook owns that and
  runs it once per push. Running `just test-all` or `bun run lint` first just
  doubles the work.
- **Never force-push** a shared branch without explicit user say-so; if you
  amended a commit that was already pushed, ask before `--force-with-lease`.
- **Read the diff before naming the commit.** A `feat` that's actually a `fix`
  pollutes the changelog the squash-merge generates.
