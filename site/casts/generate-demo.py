#!/usr/bin/env python3
"""Generate demo-report.cast — TUI simulation for landing page."""

import json
import re

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

# Box-drawing characters (extracted to avoid f-string backslash issues on Python <3.12)
BOX_TL = "\u256d"  # ╭
BOX_TR = "\u256e"  # ╮
BOX_BL = "\u2570"  # ╰
BOX_BR = "\u256f"  # ╯
BOX_H  = "\u2500"  # ─
BOX_V  = "\u2502"  # │
BLOCK_FULL  = "\u2588"  # █
BLOCK_LIGHT = "\u2591"  # ░
CHECK  = "\u2714"  # ✔
MDASH  = "\u2014"  # —
NDASH  = "\u2013"  # –
BULLET = "\u2022"  # •
ELLIP  = "\u2026"  # …

def visible_len(text):
    """Length of text with ANSI escapes stripped."""
    return len(re.sub(r'\033\[[^m]*m', '', text))

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

def bc(ch):
    """Border-colored character."""
    return f"{C_240}{ch}{RESET}"

# ── Panel builders ─────────────────────────────────────────────

LEFT_W = 58   # left panel outer width (60% of 100, minus gap)
RIGHT_W = 38  # right panel outer width
GAP = "  "

def pad_line(text, width):
    """Pad or truncate a string to exactly `width` visible characters."""
    vis = visible_len(text)
    if vis > width:
        # Truncate: strip ANSI-aware to fit, append ellipsis
        chars = list(text)
        while chars and visible_len("".join(chars)) > width - 1:
            chars.pop()
        text = "".join(chars) + ELLIP
    vis = visible_len(text)
    if vis < width:
        text += " " * (width - vis)
    return text

def progress_bar(pct, width=44):
    """Simple block progress bar."""
    filled = int(pct / 100 * width)
    empty = width - filled
    bar = BLOCK_FULL * filled + BLOCK_LIGHT * empty
    pct_str = f"{pct:3d}%"
    return f"  {bar}  {pct_str}"

def divider(width):
    return "  " + BOX_H * (width - 4)

# ── Step rendering ─────────────────────────────────────────────

def done_step(name, elapsed):
    return f"{C_241}  {C_10}{CHECK}{C_241} {name} {MDASH} {elapsed}{RESET}"

def active_step(name, spinner_char=None):
    if spinner_char is None:
        spinner_char = "\u280b"
    return f"  {C_14}{spinner_char}{RESET} {name}"

def active_detail(msg):
    return f"  {C_241}   {msg}{RESET}"

# ── Summary panel (right side) ─────────────────────────────────

def summary_panel():
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
        label_val("Sections", "All (4)"),
    ]
    return lines

def render_boxed_panel(content_lines, outer_width):
    """Render content inside a rounded-border box."""
    inner_w = outer_width - 2  # left + right border
    result = []
    h_border = C_240 + BOX_H * inner_w + RESET
    result.append(bc(BOX_TL) + h_border + bc(BOX_TR))
    for line in content_lines:
        padded = pad_line(" " + line, inner_w)
        result.append(bc(BOX_V) + padded + bc(BOX_V))
    result.append(bc(BOX_BL) + h_border + bc(BOX_BR))
    return result

# ── Frame compositor ───────────────────────────────────────────

def compose_progress_frame(pct, steps, active=None, active_detail_msg=None, spinner=None):
    """Compose a full progress-phase frame."""
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
    target_lines = HEIGHT - 6
    while len(left_content) < target_lines:
        left_content.append("")

    left_box = render_boxed_panel(left_content[:target_lines], LEFT_W)

    right_content = summary_panel()
    while len(right_content) < target_lines:
        right_content.append("")
    right_box = render_boxed_panel(right_content[:target_lines], RIGHT_W)

    lines = [banner(), ""]
    for i in range(len(left_box)):
        left = left_box[i] if i < len(left_box) else " " * LEFT_W
        right = right_box[i] if i < len(right_box) else ""
        lines.append(left + GAP + right)

    return CLEAR + "\r\n".join(lines)


def compose_preview_frame():
    """Compose the completion/preview frame."""
    content_w = WIDTH - 4

    info_lines = [
        f"{BOLD}{C_10}Report Ready{RESET}",
        f"{C_245}Open: {RESET}{C_14}file:///home/user/teamhero-report-acme-eng-2026-03-14.md{RESET}",
        f"{C_241}Tab/Arrow to switch tabs, scroll to preview, Enter/q to exit.{RESET}",
    ]
    info_box = render_boxed_panel(info_lines, WIDTH - 2)

    active_tab = f"{BOLD}{C_212} Report {RESET}"
    inactive1 = f"{C_241} Discrepancy Log (4) {RESET}"
    inactive2 = f"{C_241} JSON Data {CHECK} {RESET}"
    tab_line = active_tab + inactive1 + inactive2

    preview_lines = [
        tab_line,
        C_240 + BOX_H * content_w + RESET,
        "",
        f"  {BOLD}# Weekly Engineering Summary (2026-03-08 {NDASH} 2026-03-14){RESET}",
        "",
        f"  Processed {C_14}34 PRs{RESET} across 28 repositories, with contributions",
        f"  from {C_14}6 engineers{RESET}, {C_14}19 merged{RESET} during the window.",
        "",
        f"  {BOLD}## This Week's Visible Wins & Delivered Outcomes{RESET}",
        "",
        f"  {BOLD}Auth Service{RESET}",
        f"  {BULLET} Token validation refactor shipped; 40% latency reduction (completed).",
        f"  {BULLET} Session storage migration blocked {MDASH} legal sign-off Monday (blocked).",
        "",
        f"  {BOLD}Payments{RESET}",
        f"  {BULLET} Stripe webhook retry logic merged (completed).",
    ]

    target_h = HEIGHT - len(info_box) - 5
    while len(preview_lines) < target_h:
        preview_lines.append("")
    preview_box = render_boxed_panel(preview_lines[:target_h], WIDTH - 2)

    lines = [banner(), ""]
    lines.extend(info_box)
    lines.append("")
    lines.extend(preview_box)

    return CLEAR + "\r\n".join(lines)


# ── Timeline ───────────────────────────────────────────────────

def main():
    header = {"version": 2, "width": WIDTH, "height": HEIGHT, "timestamp": 1743724800, "title": "teamhero report demo"}
    print(json.dumps(header))

    # t=0.3: Initial — collecting org
    f = compose_progress_frame(0, [], active="Collecting organization details\u2026", spinner="\u280b")
    print(json.dumps([0.3, "o", f]))

    # t=1.2: Org ready
    f = compose_progress_frame(5, [("Organization ready: Acme Engineering", "0:01")], active="Listing repositories\u2026", spinner="\u2819")
    print(json.dumps([1.2, "o", f]))

    # t=2.4: Repos queued
    f = compose_progress_frame(10, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
    ], active="Collecting members\u2026", spinner="\u2839")
    print(json.dumps([2.4, "o", f]))

    # t=3.2: Members queued
    f = compose_progress_frame(15, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
    ], active="Calculating repository metrics (28 repos)\u2026", spinner="\u2838")
    print(json.dumps([3.2, "o", f]))

    # t=5.0: Metrics still running
    f = compose_progress_frame(30, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
    ], active="Calculating repository metrics (28 repos)\u2026", active_detail_msg="Processing acme-eng/api\u2026", spinner="\u283c")
    print(json.dumps([5.0, "o", f]))

    # t=7.5: Metrics done, Asana running
    f = compose_progress_frame(45, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
    ], active="Fetching Asana tasks for \"Platform Q1\"\u2026", spinner="\u2834")
    print(json.dumps([7.5, "o", f]))

    # t=9.5: Asana done, transcripts running
    f = compose_progress_frame(60, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
    ], active="Ingesting 3 meeting transcripts\u2026", spinner="\u2826")
    print(json.dumps([9.5, "o", f]))

    # t=11.0: Transcripts done, reconciling
    f = compose_progress_frame(75, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
        ("Meeting transcripts ingested", "0:18"),
    ], active="Reconciling sources and generating report\u2026", spinner="\u2827")
    print(json.dumps([11.0, "o", f]))

    # t=14.0: Still reconciling, higher progress
    f = compose_progress_frame(90, [
        ("Organization ready: Acme Engineering", "0:01"),
        ("Repositories queued: 28", "0:02"),
        ("Members queued: 6", "0:02"),
        ("Repository metrics (28 repos)", "0:45"),
        ("Asana tasks for \"Platform Q1\"", "0:22"),
        ("Meeting transcripts ingested", "0:18"),
    ], active="Reconciling sources and generating report\u2026", active_detail_msg="Writing individual summaries\u2026", spinner="\u280f")
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
