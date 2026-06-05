# Interview Rules

Welcome. This is a recorded, AI-collaboration coding interview. The hiring
team wants to see *how* you work with AI coding tools — not just the final
code. Use whatever AI agent, IDE, and tools you would normally use.

## Time-box

Your interview is time-boxed. The exact duration is filled in by your
interviewer in this section. **`{{TIME_BOX}}`** minutes.

## Before you begin

1. **Read `PRIVACY_RELEASE.md` carefully.** It describes what is
   recorded during the session and our privacy commitment to you.
2. **If you consent**, fill in the **## Signed** and **## Date**
   sections of `PRIVACY_RELEASE.md`. Signing is required to participate.
   If you don't consent, contact your interviewer.
3. **Run `./start.sh`** from this repo's root. It checks the release
   is signed and starts terminal recording.

## During the interview

- The brief for what to build is in either this README, in `BRIEF.md`,
  or as comments in failing tests under `tests/`. Your interviewer will
  point you to the right place.
- Use your normal AI coding workflow. Talk to your AI agent the way you
  would on any work day.
- **Verify the AI's output.** Run tests. Read diffs. Check edge cases.
- It's fine to abandon an approach. It's fine to ask the AI to back out
  changes. It's fine to push back on the AI's suggestions.
- If you finish early, polish — refactor, add tests, write docs.

## Finishing

1. Exit the asciinema recording shell (Ctrl-D or `exit`).
2. Run `./end.sh` from this repo's root. It stages the recording, the
   log, and your signed release into a single git commit.
3. Push the repo to the URL your interviewer provided:
   ```
   git push origin HEAD
   ```
4. Share the URL with your interviewer.

## Setup notes

### macOS

```
brew install asciinema
```

### Linux

```
sudo apt install asciinema    # or your distro's package manager
```

### Windows — WSL is required

The recording kit uses POSIX shell scripts and `asciinema`. Both are
WSL-native. To set up:

1. Install WSL2 (Ubuntu is fine) — `wsl --install` in an Admin
   PowerShell terminal.
2. Inside your WSL distro:
   ```
   sudo apt update
   sudo apt install asciinema git
   ```
3. Clone this repo *inside* WSL (under `~/`, not `/mnt/c/`) so file
   permissions and git work correctly.
4. Run `./start.sh` from a WSL terminal — not from PowerShell or
   Command Prompt.

If WSL is not an option for you, contact your interviewer; an
alternative recording method may be available.

## What we're observing

See `RUBRIC_OVERVIEW.md` for a plain-language summary of the dimensions
the proctor observes during the session. The hiring manager reads the
proctor's report alongside the rest of the interview signal. There is no
numerical score — the report is narrative observations and raw
measurements, and a human makes the decision.

## Questions

If anything is unclear about the rules, the release, or the brief — ask
your interviewer. There are no trick questions and no hidden criteria.
