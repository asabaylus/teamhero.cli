# Demo Section Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the landing page demo section — replace headless recording with TUI simulation, add report lightbox CTA, add hover tooltips on feature cards.

**Architecture:** Three files change: a new `.cast` file (asciicast v2 JSON-lines), HTML edits to `index.html` (title bar, wrapper div, CTA button, tooltip markup), and CSS additions to `style.css` (tooltip styles). Pure HTML/CSS, no new JS or dependencies.

**Tech Stack:** Asciicast v2 format, vanilla HTML/CSS, asciinema-player 3.8.0 (already loaded via CDN)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `site/casts/demo-report.cast` | Replace | TUI-style progress + completion simulation |
| `site/index.html` | Modify | Title bar text, wrapper div, CTA button, tooltip markup in feat-cards |
| `site/style.css` | Modify | `.feat-tooltip` styles, `.demo-cta` layout, mobile suppression |

---

### Task 1: Replace demo-report.cast with TUI simulation

**Files:**
- Replace: `site/casts/demo-report.cast`

This task creates the new asciicast v2 file that simulates the Go TUI progress phase. The file is JSON-lines: line 1 is a header object, subsequent lines are `[timestamp, "o", "text"]` tuples where `"o"` means stdout output.

**ANSI escape code reference (from TUI source):**
- `\u001b[38;5;212m` = color 212 (magenta/purple) — titles, banner prefix
- `\u001b[38;5;10m` = color 10 (green) — checkmarks, "Report Ready"
- `\u001b[38;5;14m` = color 14 (cyan) — spinner, active labels, file paths
- `\u001b[38;5;15m` = color 15 (bright white) — values
- `\u001b[38;5;240m` = color 240 — borders
- `\u001b[38;5;241m` = color 241 — dim/help text
- `\u001b[38;5;245m` = color 245 — labels
- `\u001b[1m` = bold
- `\u001b[0m` = reset
- `\u001b[2J\u001b[H` = clear screen + home cursor (for full-screen redraws)
- Box-drawing: `╭ ╮ ╰ ╯ │ ─` (UTF-8, no escapes needed)

**Gradient slashes** for the banner: The TUI renders each `/` with an interpolated hex color from `#ec84d6` to `#ba78ff`. In the cast file, use `\u001b[38;2;R;G;Bm/\u001b[0m` (24-bit color) for ~84 slashes to fill the 100-col width after the 16-char prefix.

The recording has two phases:
1. **Progress phase** (0s–18s): Two-panel layout. Steps appear one by one with spinners resolving to checkmarks. Progress bar fills incrementally.
2. **Completion phase** (18s–22s): Screen clears, "Report Ready" info frame + tabbed preview appears. Held for 4 seconds.

Total duration: ~26s (the player loops via `loop: true`).

- [ ] **Step 1: Write the cast file header and banner frame builder**

Create `site/casts/demo-report.cast`. The approach: each frame outputs a full-screen redraw (clear + full content). This is how bubbletea works — it redraws the entire view on every update.

Write a Python helper script `site/casts/generate-demo.py` that generates the cast file programmatically (hand-writing 100-column ANSI art with gradients is error-prone). The script:
- Defines the color palette, box-drawing helpers, and gradient slash renderer
- Generates each frame as a full-screen clear + redraw
- Outputs valid asciicast v2 to stdout

```python
#!/usr/bin/env python3
"""Generate demo-report.cast — TUI simulation for landing page."""

import json
import sys

WIDTH = 100
HEIGHT = 26

# ── Color helpers ──────────────────────────────────────────────

def sgr(code):
    """Return an SGR escape sequence."""
    return f"\033[{code}m"

RESET   = sgr(0)
BOLD    = sgr(1)
C_212   = sgr("38;5;212")    # purple — titles, banner
C_10    = sgr("38;5;10")     # green — checkmarks, success
C_14    = sgr("38;5;14")     # cyan — spinner, active labels
C_15    = sgr("38;5;15")     # bright white — values
C_240   = sgr("38;5;240")    # border
C_241   = sgr("38;5;241")    # dim text
C_245   = sgr("38;5;245")    # labels

CLEAR   = "\033[2J\033[H"

def gradient_slashes(count):
    """Render gradient /s from #ec84d6 → #ba78ff."""
    sr, sg_, sb = 236, 132, 214
    er, eg, eb = 186, 120, 255
    out = ""
    for i in range(count):
        t = i / max(1, count - 1)
        r = int(sr + (er - sr) * t)
        g = int(sg_ + (eg - sg_) * t)
        b = int(sb + (eb - sb) * t)
        out += f"\033[38;2;{r};{g};{b}m/\033[0m"
    return out

def banner():
    prefix = f"{C_212}//// TEAM HERO {RESET}"
    prefix_len = 15  # visible chars
    return prefix + gradient_slashes(WIDTH - 1 - prefix_len)

def border_color(ch):
    return f"{C_240}{ch}{RESET}"

def bc(ch):
    return border_color(ch)

# ── Panel builders ─────────────────────────────────────────────

LEFT_W = 58   # left panel outer width (60% of 100, minus gap)
RIGHT_W = 38  # right panel outer width
GAP = "  "

def pad_line(text, width):
    """Pad a string to exactly `width` visible characters."""
    import re
    visible = len(re.sub(r'\033\[[^m]*m', '', text))
    if visible < width:
        text += " " * (width - visible)
    return text

def progress_bar(pct, width=48):
    """Simple block progress bar."""
    filled = int(pct / 100 * width)
    empty = width - filled
    bar = "█" * filled + "░" * empty
    pct_str = f"{pct:3d}%"
    return f"  {bar}  {pct_str}"

def divider(width):
    return f"  {'─' * (width - 4)}"

# ── Step rendering ─────────────────────────────────────────────

def done_step(name, elapsed):
    return f"{C_241}  {C_10}✔{C_241} {name} — {elapsed}{RESET}"

def active_step(name, spinner_char="⠋"):
    return f"  {C_14}{spinner_char}{RESET} {name}"

def active_detail(msg):
    return f"  {C_241}   {msg}{RESET}"

# ── Summary panel (right side) ─────────────────────────────────

def summary_panel():
    inner_w = RIGHT_W - 4  # border + padding
    def label_val(label, value):
        return f"{C_245}{label}: {RESET}{C_15}{value}{RESET}"

    lines = [
        f"{BOLD}{C_212}Report Setup{RESET}",
        "",
        label_val("Organization", "acme-eng"),
        label_val("Cache", "Use cached"),
        label_val("Repositories", "All (28)"),
        label_val("Members", "All (6)"),
        label_val("Since", "2026-03-08"),
        label_val("Until", "2026-03-14"),
        label_val("Detailed", "Yes"),
        label_val("Data sources", "Git, Asana"),
        label_val("Sections", "Individual, Wins, LOC, Discrepancy Log"),
    ]
    return lines

def render_boxed_panel(title_line, content_lines, outer_width):
    """Render content inside a rounded-border box."""
    inner_w = outer_width - 2  # left + right border
    result = []
    # Top border
    result.append(f"{bc('╭')}{'─' * inner_w}{bc('╮')}")
    for line in content_lines:
        padded = pad_line(f" {line}", inner_w)
        result.append(f"{bc('│')}{padded}{bc('│')}")
    # Bottom border
    result.append(f"{bc('╰')}{'─' * inner_w}{bc('╯')}")
    return result

# ── Frame compositor ───────────────────────────────────────────

def compose_progress_frame(pct, steps, active=None, active_detail_msg=None, spinner="⠋"):
    """Compose a full progress-phase frame."""
    # Left panel content
    left_content = [
        f"{BOLD}{C_212}Report Progress{RESET}",
        "",
        progress_bar(pct, LEFT_W - 14),
        divider(LEFT_W - 2),
    ]
    for name, elapsed in steps:
        left_content.append(done_step(name, elapsed))
    if active:
        left_content.append(active_step(active, spinner))
    if active_detail_msg:
        left_content.append(active_detail(active_detail_msg))

    # Pad to fill height
    target_lines = HEIGHT - 6  # banner + gap + top/bottom borders
    while len(left_content) < target_lines:
        left_content.append("")

    left_box = render_boxed_panel("", left_content[:target_lines], LEFT_W)

    # Right panel
    right_content = summary_panel()
    while len(right_content) < target_lines:
        right_content.append("")
    right_box = render_boxed_panel("", right_content[:target_lines], RIGHT_W)

    # Compose
    lines = [banner(), ""]
    for i in range(len(left_box)):
        left = left_box[i] if i < len(left_box) else " " * LEFT_W
        right = right_box[i] if i < len(right_box) else ""
        lines.append(left + GAP + right)

    return CLEAR + "\r\n".join(lines)


def compose_preview_frame():
    """Compose the completion/preview frame."""
    content_w = WIDTH - 4  # border + padding

    # Info frame
    info_lines = [
        f"{BOLD}{C_10}Report Ready{RESET}",
        f"{C_245}Open: {RESET}{C_14}file:///home/user/teamhero-report-acme-eng-2026-03-14.md{RESET}",
        f"{C_241}Tab/Arrow to switch tabs, scroll to preview, Enter/q to exit.{RESET}",
    ]
    info_box = render_boxed_panel("", info_lines, WIDTH - 2)

    # Tab bar
    active_tab = f"{BOLD}{C_212} Report {RESET}"
    inactive1 = f"{C_241} Discrepancy Log (4) {RESET}"
    inactive2 = f"{C_241} JSON Data ✔ {RESET}"
    tab_line = active_tab + inactive1 + inactive2

    # Preview content
    preview_lines = [
        tab_line,
        f"{'─' * content_w}",
        "",
        f"  {BOLD}# Weekly Engineering Summary (2026-03-08 – 2026-03-14){RESET}",
        "",
        f"  Processed {C_14}34 PRs{RESET} across 28 repositories, with contributions",
        f"  from {C_14}6 engineers{RESET}, {C_14}19 merged{RESET} during the window.",
        "",
        f"  {BOLD}## This Week's Visible Wins & Delivered Outcomes{RESET}",
        "",
        f"  {BOLD}Auth Service{RESET}",
        f"  • Token validation refactor shipped; 40% latency reduction (completed).",
        f"  • Session storage migration blocked — legal sign-off Monday (blocked).",
        "",
        f"  {BOLD}Payments{RESET}",
        f"  • Stripe webhook retry logic merged (completed).",
    ]

    target_h = HEIGHT - len(info_box) - 5
    while len(preview_lines) < target_h:
        preview_lines.append("")
    preview_box = render_boxed_panel("", preview_lines[:target_h], WIDTH - 2)

    lines = [banner(), ""]
    lines.extend(info_box)
    lines.append("")
    lines.extend(preview_box)

    return CLEAR + "\r\n".join(lines)


# ── Timeline ───────────────────────────────────────────────────

def main():
    frames = []

    # Header
    header = {"version": 2, "width": WIDTH, "height": HEIGHT, "timestamp": 1743724800, "title": "teamhero report demo"}
    print(json.dumps(header))

    # Frame sequence: [time, content_fn_args]
    # Phase 1: Progress steps appearing one by one

    spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    # t=0.3: Initial — collecting org
    f = compose_progress_frame(0, [], active="Collecting organization details…", spinner="⠋")
    print(json.dumps([0.3, "o", f]))

    # t=1.2: Org ready
    f = compose_progress_frame(5, [("Organization ready: Acme Engineering", "0:01")], active="Listing repositories…", spinner="⠙")
    print(json.dumps([1.2, "o", f]))

    # t=2.4: Repos queued
    f = compose_progress_frame(10, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
    ], active="Collecting members…", spinner="⠹")
    print(json.dumps([2.4, "o", f]))

    # t=3.2: Members queued
    f = compose_progress_frame(15, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
    ], active="Calculating repository metrics (28 repos)…", spinner="⠸")
    print(json.dumps([3.2, "o", f]))

    # t=5.0: Metrics still running
    f = compose_progress_frame(30, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
    ], active="Calculating repository metrics (28 repos)…", active_detail_msg="Processing acme-eng/api…", spinner="⠼")
    print(json.dumps([5.0, "o", f]))

    # t=7.5: Metrics done, Asana running
    f = compose_progress_frame(45, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
    ], active="Fetching Asana tasks for \"Platform Q1\"…", spinner="⠴")
    print(json.dumps([7.5, "o", f]))

    # t=9.5: Asana done, transcripts running
    f = compose_progress_frame(60, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
    ], active="Ingesting 3 meeting transcripts…", spinner="⠦")
    print(json.dumps([9.5, "o", f]))

    # t=11.0: Transcripts done, reconciling
    f = compose_progress_frame(75, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
        ("Meeting transcripts ingested", "0:18"),
    ], active="Reconciling sources and generating report…", spinner="⠧")
    print(json.dumps([11.0, "o", f]))

    # t=14.0: Still reconciling, higher progress
    f = compose_progress_frame(90, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
        ("Meeting transcripts ingested", "0:18"),
    ], active="Reconciling sources and generating report…", active_detail_msg="Writing individual summaries…", spinner="⠏")
    print(json.dumps([14.0, "o", f]))

    # t=17.0: All done, 100%
    f = compose_progress_frame(100, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
        ("Meeting transcripts ingested", "0:18"),
        ("Report generated", "2:41"),
    ])
    print(json.dumps([17.0, "o", f]))

    # t=18.5: Preview screen
    f = compose_preview_frame()
    print(json.dumps([18.5, "o", f]))

    # t=22.5: Hold — 4 seconds of nothing, then recording ends (player loops)
    print(json.dumps([22.5, "o", ""]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the generator and write the cast file**

Run:
```bash
cd /home/fragnot/Project/teamhero.scripts
python3 site/casts/generate-demo.py > site/casts/demo-report.cast
```

- [ ] **Step 3: Verify the cast file is valid**

Run:
```bash
head -1 site/casts/demo-report.cast | python3 -c "import sys,json; json.load(sys.stdin); print('Header OK')"
wc -l site/casts/demo-report.cast
```

Expected: `Header OK` and ~12 lines (1 header + 11 frames).

- [ ] **Step 4: Commit**

```bash
git add site/casts/demo-report.cast site/casts/generate-demo.py
git commit -m "feat(site): replace headless recording with TUI simulation

New demo-report.cast shows the real bubbletea TUI progress phase
with two-panel layout, gradient banner, and 4s hold on completion.
Includes generator script for future re-generation."
```

---

### Task 2: Update terminal title bar and add CTA button

**Files:**
- Modify: `site/index.html` (lines 148-178, the "What You Get" section)

- [ ] **Step 1: Change terminal title bar text**

In `site/index.html`, change line 154:

```html
<!-- OLD -->
<div class="term-title">teamhero report --headless --foreground</div>

<!-- NEW -->
<div class="term-title">teamhero report</div>
```

- [ ] **Step 2: Wrap terminal + CTA in a container div**

The current `.report-layout` grid has two direct children: `.terminal` and `.feat-cards`. Wrap the terminal in a container and add the CTA button after it.

Change lines 148-157 from:

```html
<div class="report-layout">
    <div class="terminal reveal">
      <div class="term-bar">
        <div class="term-dot r"></div>
        <div class="term-dot y"></div>
        <div class="term-dot g"></div>
        <div class="term-title">teamhero report</div>
      </div>
      <div id="asciinema-report"></div>
    </div>
    <div class="feat-cards reveal">
```

To:

```html
<div class="report-layout">
    <div class="demo-column">
      <div class="terminal reveal">
        <div class="term-bar">
          <div class="term-dot r"></div>
          <div class="term-dot y"></div>
          <div class="term-dot g"></div>
          <div class="term-title">teamhero report</div>
        </div>
        <div id="asciinema-report"></div>
      </div>
      <div class="demo-cta reveal">
        <button class="btn-example-report" onclick="document.getElementById('report-modal').classList.add('open')">
          See the full example report
        </button>
      </div>
    </div>
    <div class="feat-cards reveal">
```

And close the `.demo-column` div — the `.feat-cards` closing `</div>` stays the same, so just add a closing `</div>` after the `.demo-cta` block but before `.feat-cards`.

Actually, looking at the HTML structure more carefully — the closing `</div>` for `.report-layout` is already correct. We just need to:
1. Add `<div class="demo-column">` before `.terminal`
2. Add the CTA button + `</div>` (closing `.demo-column`) after `.terminal`'s closing tag

- [ ] **Step 3: Verify structure in browser**

Open `site/index.html` in a browser. The terminal and CTA button should stack vertically in the left column. The feature cards should remain in the right column.

- [ ] **Step 4: Commit**

```bash
git add site/index.html
git commit -m "feat(site): update terminal title and add report CTA below demo"
```

---

### Task 3: Add CSS for demo-column and demo-cta

**Files:**
- Modify: `site/style.css` (after the `.report-layout` block, around line 362)

- [ ] **Step 1: Add demo-column and demo-cta styles**

Insert after the `.report-layout` media query (after line 362 in `style.css`):

```css
/* Demo column: terminal + CTA stacked */
.demo-column {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.demo-cta {
  display: flex;
}
```

No other CSS changes needed — `.btn-example-report` already exists and is styled.

- [ ] **Step 2: Verify the CTA renders correctly**

Open the page. The "See the full example report" button should appear directly below the terminal, left-aligned, using the existing ghost-button style.

- [ ] **Step 3: Commit**

```bash
git add site/style.css
git commit -m "style(site): add demo-column flex layout for terminal + CTA"
```

---

### Task 4: Add tooltip markup to feature cards

**Files:**
- Modify: `site/index.html` (lines 158-177, the four `.feat-card` divs)

- [ ] **Step 1: Add tooltip div to "Hard numbers, real sources" card**

Replace the first `.feat-card` (lines 159-162):

```html
<!-- OLD -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">📊</span> Hard numbers, real sources</div>
  <div class="feat-card-body">PRs, commits, task counts, velocity — pulled directly from GitHub and Asana, not guessed. Every number in the report is defensible.</div>
</div>

<!-- NEW -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">📊</span> Hard numbers, real sources</div>
  <div class="feat-card-body">PRs, commits, task counts, velocity — pulled directly from GitHub and Asana, not guessed. Every number in the report is defensible.</div>
  <div class="feat-tooltip">
    <div class="feat-tooltip-arrow"></div>
    <table class="feat-tooltip-table">
      <thead><tr><th>Developer</th><th>Commits</th><th>PRs</th><th>Merged</th><th>+Lines</th></tr></thead>
      <tbody>
        <tr><td>Sarah Chen</td><td>47</td><td>6</td><td>5</td><td>3,218</td></tr>
        <tr><td>Marcus Rivera</td><td>31</td><td>4</td><td>4</td><td>1,842</td></tr>
        <tr><td>Priya Patel</td><td>28</td><td>5</td><td>4</td><td>4,521</td></tr>
      </tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 2: Add tooltip div to "Discrepancy log" card**

Replace the second `.feat-card`:

```html
<!-- OLD -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">⚠️</span> Discrepancy log</div>
  <div class="feat-card-body">Team Hero catches conflicts between your data sources before your boss does. The ticket that says one thing and the PR that says another — flagged, every time.</div>
</div>

<!-- NEW -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">⚠️</span> Discrepancy log</div>
  <div class="feat-card-body">Team Hero catches conflicts between your data sources before your boss does. The ticket that says one thing and the PR that says another — flagged, every time.</div>
  <div class="feat-tooltip">
    <div class="feat-tooltip-arrow"></div>
    <table class="feat-tooltip-table">
      <thead><tr><th>#</th><th>Issue</th><th>Confidence</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>PR #412 merged Wed — Asana task still In Progress</td><td>90%</td></tr>
        <tr><td>2</td><td>ARM migration cost claim — no billing data provided</td><td>85%</td></tr>
      </tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 3: Add tooltip div to "Configurable sections" card**

Replace the third `.feat-card`:

```html
<!-- OLD -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">🎛️</span> Configurable sections</div>
  <div class="feat-card-body">Generate only what your executive actually reads. Skip what's irrelevant. Adjust scope per team, per project, per week.</div>
</div>

<!-- NEW -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">🎛️</span> Configurable sections</div>
  <div class="feat-card-body">Generate only what your executive actually reads. Skip what's irrelevant. Adjust scope per team, per project, per week.</div>
  <div class="feat-tooltip">
    <div class="feat-tooltip-arrow"></div>
    <div class="feat-tooltip-tui">
      <div class="feat-tooltip-tui-title">Select report sections</div>
      <div class="feat-tooltip-tui-row"><span class="tui-check on">✔</span> Individual Contributions</div>
      <div class="feat-tooltip-tui-row"><span class="tui-check on">✔</span> Visible Wins</div>
      <div class="feat-tooltip-tui-row"><span class="tui-check on">✔</span> Lines of Code (LOC)</div>
      <div class="feat-tooltip-tui-row"><span class="tui-check on">✔</span> Discrepancy Log</div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Add tooltip div to "Your API key, your cost" card**

Replace the fourth `.feat-card`:

```html
<!-- OLD -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">💸</span> Your API key. Your cost.</div>
  <div class="feat-card-body">No subscription. No premium tier. Bring your own AI API key. Team Hero uses it for inference and gets out of the way.
    <div class="cost-chip">≈ $0.02 per report</div>
  </div>
</div>

<!-- NEW -->
<div class="feat-card">
  <div class="feat-card-title"><span class="feat-icon">💸</span> Your API key. Your cost.</div>
  <div class="feat-card-body">No subscription. No premium tier. Bring your own AI API key. Team Hero uses it for inference and gets out of the way.
    <div class="cost-chip">≈ $0.02 per report</div>
  </div>
  <div class="feat-tooltip">
    <div class="feat-tooltip-arrow"></div>
    <div class="feat-tooltip-tui">
      <div class="feat-tooltip-tui-row"><span style="color:#3DD68C;">✔</span> Done in 4m 12s</div>
      <div class="feat-tooltip-tui-row"><span style="color:#7B7B9A;">Cost:</span> ~$0.02 (GPT-4o, 12,847 tokens)</div>
      <div class="feat-tooltip-tui-row"><span style="color:#3DD68C;">✔</span> Report saved: teamhero-report-acme-eng-2026-03-14.md</div>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add site/index.html
git commit -m "feat(site): add tooltip markup to feature cards with report previews"
```

---

### Task 5: Add tooltip CSS styles

**Files:**
- Modify: `site/style.css` (after the `.feat-card` styles, around line 451)

- [ ] **Step 1: Add tooltip base styles**

Insert after the `.cost-chip` rule (after line 451 in `style.css`):

```css
/* ===== FEATURE CARD TOOLTIPS ===== */
.feat-card {
  position: relative;
}
.feat-tooltip {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  max-width: 380px;
  min-width: 260px;
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  padding: 0.75rem 1rem;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text);
  z-index: 50;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.2s ease 0.15s, visibility 0.2s ease 0.15s;
}
.feat-card:hover .feat-tooltip {
  opacity: 1;
  visibility: visible;
}
.feat-tooltip-arrow {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 12px;
  height: 12px;
  background: #1a1a2e;
  border-right: 1px solid rgba(255,255,255,0.12);
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
```

- [ ] **Step 2: Add tooltip table styles**

Continuing in the same location:

```css
/* Tooltip table (for stats and discrepancy previews) */
.feat-tooltip-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
}
.feat-tooltip-table th {
  text-align: left;
  font-weight: 500;
  color: var(--muted);
  padding: 0 0.4rem 0.3rem;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-size: 0.65rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.feat-tooltip-table td {
  padding: 0.2rem 0.4rem;
  color: var(--text);
  white-space: nowrap;
}
.feat-tooltip-table tbody tr:first-child td {
  padding-top: 0.35rem;
}
```

- [ ] **Step 3: Add TUI-style tooltip styles (for sections & cost cards)**

```css
/* TUI-style tooltip content */
.feat-tooltip-tui {
  line-height: 1.8;
}
.feat-tooltip-tui-title {
  color: var(--muted);
  font-size: 0.65rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 0.3rem;
}
.feat-tooltip-tui-row {
  color: var(--text);
}
.tui-check {
  display: inline-block;
  width: 1.2em;
  text-align: center;
}
.tui-check.on {
  color: var(--green);
}
```

- [ ] **Step 4: Add mobile suppression**

Add inside the existing `@media (max-width: 640px)` block at line 986:

```css
.feat-tooltip { display: none; }
```

- [ ] **Step 5: Verify tooltips work**

Open the page and hover over each feature card. Verify:
- Tooltip fades in above the card after ~150ms delay
- Arrow points down to the card
- Content matches spec (table for first two, TUI mockup for last two)
- Tooltips disappear when mouse leaves
- No tooltips on mobile viewport (resize to <640px)

- [ ] **Step 6: Commit**

```bash
git add site/style.css
git commit -m "style(site): add hover tooltip styles for feature card previews"
```

---

### Task 6: Visual review and cleanup

**Files:**
- Possibly adjust: `site/casts/demo-report.cast`, `site/index.html`, `site/style.css`

- [ ] **Step 1: Open the full page and review**

Open `site/index.html` in a browser. Check:
1. Terminal title shows `teamhero report` (not `--headless --foreground`)
2. Recording shows TUI-style two-panel layout with gradient banner
3. Recording holds on final "Report Ready" frame for ~4s before looping
4. "See the full example report" button appears below the terminal
5. Clicking the CTA opens the report modal
6. All four feature card tooltips show on hover with correct content
7. Responsive: at <960px, the two-column layout stacks. At <640px, tooltips are hidden.

- [ ] **Step 2: Fix any issues found**

Adjust spacing, alignment, or content as needed based on review.

- [ ] **Step 3: Final commit**

```bash
git add -u site/
git commit -m "fix(site): polish demo section layout and tooltip alignment"
```
