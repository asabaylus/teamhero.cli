---
name: release
description: >-
  Cut a release end-to-end: confirm main is up to date and CI is green, pick the
  next semver tag, then push an annotated `vX.Y.Z` tag to trigger the Release
  workflow (builds the TS service for 5 platforms, the plugin zip, then GoReleaser
  → GitHub Release + Homebrew tap + .deb/APT). Watch the workflow to completion
  with `gh run watch`, then verify the deploy actually landed by running
  `brew upgrade teamhero` and checking `teamhero --version` matches the tag. Use
  this whenever the user wants to "cut a release", "ship a release", "tag a
  release", "publish a new version", "do a release", or "release vX.Y.Z". Pushing
  a release tag publishes publicly (GitHub + Homebrew + APT) and is hard to walk
  back, so ALWAYS confirm the version with the user before pushing the tag.
---

# /release — tag, publish, and verify a release

There is no `just release` recipe and no manual version-file to bump — a release
is cut entirely by **pushing a tag matching `v*`**. That tag triggers
`.github/workflows/release.yml`, which:

1. Builds the **TS service** binary for 5 targets (linux x64/arm64, macOS
   x64/arm64, windows x64) via `bun build --compile`.
2. Builds the **plugin zip** (`scripts/build-plugin.sh`).
3. Runs **GoReleaser** (`.goreleaser.yml`), which builds the **Go TUI** for
   linux/darwin/windows × amd64/arm64 — injecting the version from the tag via
   `-ldflags -X main.version={{.Version}}` — then creates the **GitHub Release**
   (`draft: false`, `prerelease: auto`, github-native changelog), publishes the
   **Homebrew** formula `teamhero` to `asabaylus/homebrew-teamhero`, and builds
   `.deb` packages.
4. On a non-prerelease being *published*, `update-apt.yml` updates the **APT
   repo** (`if: "!github.event.release.prerelease"`).

The version flows from the tag → GoReleaser → the binary, so `teamhero --version`
on an upgraded install is the ground-truth that the release deployed. That round
trip — tag, watch, `brew upgrade`, check `--version` — is what this skill closes.

Work the phases in order.

## Phase 0 — Orient

A release tags a specific commit on `main`, so confirm the state before tagging:

```bash
git rev-parse --abbrev-ref HEAD          # are we on main?
git fetch origin --tags                  # get latest commits AND existing tags
git status --short --branch              # clean tree? ahead/behind origin/main?
git log --oneline origin/main -5         # what's the HEAD commit being released
git tag --sort=-v:refname | head -5      # latest existing release tags
```

Decide:

- **Tag `main`, not a feature branch.** If not on `main`, `git checkout main`
  first. If `main` is behind `origin/main`, `git pull --ff-only` so you tag the
  same commit GitHub will release.
- **The tree must be clean.** A release tags a committed point; uncommitted
  changes mean the working state doesn't match what ships. Stop and surface it.
- **CI must be green on the commit you're about to tag.** Don't release a red
  `main`:
  ```bash
  gh run list --branch main --limit 5
  ```
  If the latest `main` run isn't success, stop and report it — releasing a
  broken `main` ships broken artifacts to Homebrew and APT.

## Phase 1 — Pick the version (and CONFIRM with the user)

Tags are `vX.Y.Z` (pre-1.0; this repo uses minor bumps for features, patch for
fixes). From the latest tag, propose the next:

- **New feature / capability** → bump **minor** (`v0.2.2` → `v0.3.0`).
- **Bug fixes / chores only** → bump **patch** (`v0.2.2` → `v0.2.3`).
- **Rehearsal / risky release** → propose a **prerelease** `vX.Y.Z-rc.N`
  (`v0.3.0-rc.1`). `prerelease: auto` marks it a GitHub prerelease and
  `update-apt.yml` skips it, so you can verify GitHub Release + Homebrew without
  touching the stable APT channel. The repo already has a `v0.1.0-rc.1`
  precedent.

Skim what changed since the last tag to justify the bump:

```bash
git log --oneline $(git describe --tags --abbrev=0)..origin/main
```

**Then confirm the exact version string with the user before pushing anything.**
Pushing the tag publishes publicly and is hard to reverse — never pick the
version unilaterally. State your recommendation and the reasoning, and wait for
their go-ahead (or a prerelease-first preference).

## Phase 2 — Tag and push (this publishes)

GoReleaser reads the tag, so an **annotated** tag is required (lightweight tags
can confuse `git describe`). Tag the exact `main` commit and push *only the tag*:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z              # ← triggers .github/workflows/release.yml
```

Guardrails:

- **Never delete/re-push a tag that already published** to fix a mistake —
  Homebrew and APT consumers have already seen it. Cut the next patch instead.
- If a tag push fails because the tag exists locally but not remotely (a prior
  aborted run), reconcile with the user before forcing anything.

## Phase 3 — Watch the release workflow to completion

The tag push kicks off the `Release` workflow. Watch it — but as a **background**
task so the session stays responsive (a full multi-platform + GoReleaser run
takes several minutes):

```bash
# give Actions a moment to register the run, then grab its id:
gh run list --workflow release.yml --limit 1
gh run watch <run-id> --interval 30      # run in the background; exit status is the signal
```

`gh run watch` exits non-zero if any job fails.

- **If it fails:** read the failing job (`gh run view <run-id> --log-failed`),
  diagnose, and report. Don't blindly re-tag — a GoReleaser/permissions failure
  (e.g. missing `HOMEBREW_TAP_TOKEN`) needs a fix, not a new tag. A code fix
  means a new patch tag once `main` is green again.
- **If it's a non-prerelease and succeeds:** the GitHub Release is published and
  `update-apt.yml` fires for the APT repo. For a prerelease, APT is intentionally
  skipped.

## Phase 4 — Verify the deploy landed (brew + --version)

A green workflow means artifacts published; this phase proves the *installed*
tool actually updated. GoReleaser pushes the Homebrew formula to the tap, so:

```bash
brew update                               # refresh the tap so the new formula is visible
brew upgrade teamhero                     # pull the just-released bottle/formula
teamhero --version                        # must print the version you just tagged (sans leading v)
```

The injected version is the tag **without** the leading `v` (e.g. tag `v0.3.0` →
`teamhero --version` prints `0.3.0`). Confirm they match:

- **Match** → the release is live and verified. Report success (Phase 5).
- **`brew upgrade` says already up to date / prints the old version** → the tap
  may not have the new formula yet (Homebrew can lag a beat after the run). Give
  it a moment, `brew update` again, and retry once. If it still lags, note that
  the GitHub Release is published and the formula will propagate shortly — don't
  treat tap latency as a release failure.
- **`teamhero` not installed via brew here** → skip the upgrade, and instead
  confirm the artifact on the Release page (`gh release view vX.Y.Z`) so the user
  still gets a concrete "it shipped" confirmation.

## Phase 5 — Report

Tell the user it's out, with the concrete evidence:

- The tag and the GitHub Release URL (`gh release view vX.Y.Z --json url -q .url`).
- The verified `teamhero --version` output.
- Whether APT updated (stable) or was skipped (prerelease).
- For a prerelease: the next step is to cut the final `vX.Y.Z` once the rc checks
  out.

## Quick reference

```bash
# orient
git checkout main && git fetch origin --tags && git pull --ff-only
gh run list --branch main --limit 1            # main must be green

# tag + push (after confirming version with the user)
git tag -a v0.3.0 -m "v0.3.0" && git push origin v0.3.0

# watch (background)
gh run list --workflow release.yml --limit 1
gh run watch <run-id> --interval 30

# verify
brew update && brew upgrade teamhero && teamhero --version   # must print 0.3.0
gh release view v0.3.0 --json url -q .url
```
