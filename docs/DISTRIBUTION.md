# Distribution & Release Process

How TeamHero is built, packaged, and released. This document is for **maintainers** cutting releases. For installation instructions, see the [README](../README.md).

## How it ships

TeamHero ships as **two binaries** per platform:

| Binary | Language | Purpose |
|--------|----------|---------|
| `teamhero-tui` | Go | CLI entry point, TUI wizard, progress display, doctor, setup |
| `teamhero-service` | TypeScript (compiled via Bun) | Report generation engine (GitHub, Asana, OpenAI) |

The TUI spawns the service as a subprocess, communicating via JSON-lines over stdin/stdout. Both must be in the same directory for the release layout to work. In development, the TUI falls back to `bun run scripts/run-report.ts` if no compiled service binary is found.

## Cutting a release

Releases are fully automated. Push a version tag and everything happens via CI:

```bash
git tag v1.2.3
git push origin v1.2.3
```

### What happens

The release workflow (`.github/workflows/release.yml`) runs three jobs:

**Job 1: `build-service`** — Builds the Bun service binary for 5 platform/arch combinations (linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64).

**Job 2: `plugin`** — Builds the Claude Code plugin zip (linux-amd64 TUI + UPX compression).

**Job 3: `goreleaser`** — Downloads all artifacts, then runs GoReleaser to:
1. Cross-compile the Go TUI for all 5 targets
2. Package archives (`.tar.gz` for Unix, `.zip` for Windows) with both binaries
3. Generate `.deb` packages for linux/amd64 and linux/arm64
4. Compute SHA256 checksums
5. Create the GitHub Release with all artifacts
6. Push the updated Homebrew formula to `asabaylus/homebrew-teamhero`

**Post-release:** The `update-apt.yml` workflow triggers on `release: published`, downloads the `.deb` files, and updates the signed APT repository at `asabaylus/apt.teamhero.dev`.

### Pre-release testing

```bash
git tag v1.2.3-rc.1
git push origin v1.2.3-rc.1
```

Pre-release tags create a GitHub pre-release (marked automatically). The APT workflow skips pre-releases.

### GoReleaser config

All packaging logic is in `.goreleaser.yml`. Key sections:

- **builds** — Go cross-compilation targets, CGO disabled, version via ldflags
- **archives** — Archive format and naming, includes pre-built service binaries
- **brews** — Auto-push Homebrew formula to the tap repo
- **nfpms** — `.deb` package generation
- **release** — GitHub Release config, extra files (plugin zip, install script)

### Local dry run

```bash
goreleaser check                       # Validate config
goreleaser release --snapshot --clean   # Full dry run (no publish)
ls dist/                               # Inspect output
```

## Versioning

Version is injected at build time via Go linker flags:

```bash
go build -ldflags "-X main.version=1.2.3" -o teamhero-tui .
```

`var version = "dev"` in `tui/main.go` defaults to `"dev"` for local builds. GoReleaser injects the tag version automatically.

## CI secrets

| Secret | Purpose |
|--------|---------|
| `HOMEBREW_TAP_TOKEN` | PAT to push formula to `asabaylus/homebrew-teamhero` |
| `APT_GPG_PRIVATE_KEY` | GPG private key for signing APT metadata |
| `APT_GPG_PASSPHRASE` | GPG key passphrase |
| `APT_REPO_TOKEN` | PAT to push to `asabaylus/apt.teamhero.dev` |

See [Infrastructure Setup](INFRASTRUCTURE_SETUP.md) for how to create and rotate these.

## Binary resolution at runtime

If you're troubleshooting "binary not found" errors, here's how each binary is located:

**TUI binary** (`src/lib/tui-resolver.ts`):
1. `TEAMHERO_TUI_PATH` environment variable
2. `tui/teamhero-tui` relative to the CLI source (development)
3. `teamhero-tui` on system `PATH` (installed)

**Service binary** (`tui/runner.go`):
1. `teamhero-service` next to the running TUI executable (installed)
2. `bun run scripts/run-report.ts` (development fallback)

## Claude Code plugin

The plugin zip is built in CI and attached to every GitHub Release.

```
claude-plugin/
  .claude-plugin/plugin.json        # Plugin manifest
  bin/teamhero-tui                  # UPX-compressed TUI binary (linux-amd64)
  skills/generate-report/SKILL.md   # Skill instructions for the agent
```

Build locally: `./scripts/build-plugin.sh` (must be under 50MB).

## Quick reference

| Task | Command |
|------|---------|
| Dev build (all) | `just build-all` |
| Run tests | `just test-all` |
| Cross-compile all platforms | `cd tui && make all VERSION=v1.2.3` |
| Build service binary | `bun run build:service` |
| Build plugin zip | `./scripts/build-plugin.sh` |
| Cut a release | `git tag v1.2.3 && git push origin v1.2.3` |
| Validate GoReleaser | `goreleaser check` |
| Local release dry run | `goreleaser release --snapshot --clean` |
