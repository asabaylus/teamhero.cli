package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/reflow/wordwrap"
)

// runBootstrapGenerate wraps a synchronous BootstrapRunner.Run call in a
// bubbletea program so the user sees a spinner while the bun subprocess works
// and lands on a persistent result screen after — instead of having the TUI
// exit silently the moment the subprocess returns. The result screen shows
// the absolute output path as an OSC 8 hyperlink (ctrl-click opens it in the
// OS file browser) and waits for esc / ctrl+c / q before quitting.
//
// Returns the same int the underlying runner would have returned. Stderr from
// the subprocess is mirrored to the caller's stderr after the result screen
// dismisses so warnings aren't swallowed.
var runBootstrapGenerate = func(
	runner BootstrapRunner,
	opts *BootstrapOptions,
	stdout, stderr io.Writer,
) int {
	m := newBootstrapGenerateModel(runner, opts)
	p := tea.NewProgram(m, tea.WithAltScreen())
	final, err := p.Run()
	if err != nil {
		fmt.Fprintf(stderr, "Result screen failed: %v\n", err)
		return 1
	}
	gm, ok := final.(*bootstrapGenerateModel)
	if !ok {
		return 1
	}
	// Forward captured subprocess streams to the caller now that the alt-screen
	// is torn down. Stdout first (consola success line) then stderr (warnings).
	if gm.stdoutBuf.Len() > 0 {
		_, _ = io.Copy(stdout, &gm.stdoutBuf)
	}
	if gm.stderrBuf.Len() > 0 {
		_, _ = io.Copy(stderr, &gm.stderrBuf)
	}
	return gm.exitCode
}

// bootstrapGeneratePhase is the high-level state of the result screen.
type bootstrapGeneratePhase int

const (
	bgPhaseRunning bootstrapGeneratePhase = iota
	bgPhaseSuccess
	bgPhaseFailure
)

// bootstrapGenerateModel renders the generation spinner and, after the
// subprocess returns, the result screen. The model owns the captured
// stdout/stderr buffers so the parent can forward them once the TUI exits.
type bootstrapGenerateModel struct {
	runner BootstrapRunner
	opts   *BootstrapOptions

	phase     bootstrapGeneratePhase
	exitCode  int
	stdoutBuf bytes.Buffer
	stderrBuf bytes.Buffer

	spin          spinner.Model
	width, height int
}

// subprocessDoneMsg is dispatched once the bun subprocess returns. exitCode
// is the runner's int return — non-zero means generation failed.
type subprocessDoneMsg struct {
	exitCode int
}

func newBootstrapGenerateModel(runner BootstrapRunner, opts *BootstrapOptions) *bootstrapGenerateModel {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("14"))
	return &bootstrapGenerateModel{
		runner: runner,
		opts:   opts,
		phase:  bgPhaseRunning,
		spin:   sp,
	}
}

func (m *bootstrapGenerateModel) Init() tea.Cmd {
	return tea.Batch(m.spin.Tick, m.runSubprocess())
}

// runSubprocess returns a tea.Cmd that drives the bun subprocess on a
// goroutine (Bubble Tea runs Cmd in a goroutine) and emits a subprocessDoneMsg
// when it finishes.
func (m *bootstrapGenerateModel) runSubprocess() tea.Cmd {
	return func() tea.Msg {
		code := m.runner.Run(m.opts, &m.stdoutBuf, &m.stderrBuf)
		return subprocessDoneMsg{exitCode: code}
	}
}

func (m *bootstrapGenerateModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil

	case tea.KeyMsg:
		// In running phase we deliberately ignore most keys so a stray press
		// doesn't kill the in-flight subprocess and leave a half-written
		// scaffold. Ctrl+C still works as a hard abort.
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
		if m.phase == bgPhaseRunning {
			return m, nil
		}
		switch msg.String() {
		case "esc", "q", "enter":
			return m, tea.Quit
		}
		return m, nil

	case subprocessDoneMsg:
		m.exitCode = msg.exitCode
		if msg.exitCode == 0 {
			m.phase = bgPhaseSuccess
		} else {
			m.phase = bgPhaseFailure
		}
		return m, nil

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spin, cmd = m.spin.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m *bootstrapGenerateModel) View() string {
	w := m.width
	if w <= 0 {
		w = 80
	}

	header := renderShellHeader(w)
	hintStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

	var body, hints string
	switch m.phase {
	case bgPhaseRunning:
		body = m.renderRunning()
		hints = hintStyle.Render("ctrl+c to abort")
	case bgPhaseSuccess:
		body = m.renderSuccess()
		hints = hintStyle.Render("esc / ctrl+c to dismiss")
	case bgPhaseFailure:
		body = m.renderFailure()
		hints = hintStyle.Render("esc / ctrl+c to dismiss")
	}

	return lipgloss.JoinVertical(lipgloss.Left, header, "", body, "", hints)
}

func (m *bootstrapGenerateModel) renderRunning() string {
	label := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	model := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("14"))
	return fmt.Sprintf(
		"  %s %s\n\n  %s\n  %s %s\n",
		m.spin.View(),
		title.Render("Generating role scaffold…"),
		label.Render("OpenAI is drafting your role files; this typically takes 30–90 seconds."),
		label.Render("Model:"),
		model.Render(bootstrapModelName()),
	)
}

// bootstrapModelName returns the OpenAI model the generator is configured
// to use. Mirrors the precedence in OpenAIGeneratorClient: the
// AI_MODEL env var overrides the gpt-5-mini default. Surfaced in the
// TUI so the proctor sees which LLM is on the hook before a $1+ run.
func bootstrapModelName() string {
	if v := strings.TrimSpace(os.Getenv("AI_MODEL")); v != "" {
		return v
	}
	return "gpt-5-mini"
}

func (m *bootstrapGenerateModel) renderSuccess() string {
	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("10")) // green
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	pathStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("14"))

	abs, link := absPathLink(m.opts.OutputDir)
	pathLine := osc8Link(link, pathStyle.Render(abs))

	return strings.Join([]string{
		"  " + titleStyle.Render("✓ Role scaffold ready"),
		"",
		"  " + labelStyle.Render("Output: ") + pathLine,
		"  " + labelStyle.Render("Ctrl-click the path above to open it in your file manager."),
	}, "\n")
}

func (m *bootstrapGenerateModel) renderFailure() string {
	w := m.width
	if w <= 0 {
		w = 80
	}
	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("9")) // red
	labelStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))

	// Wrap each captured stderr line to fit the terminal so long error
	// messages (e.g. "ERROR - No failing/skipped tests found …") aren't
	// truncated by the alt-screen. Body lines are indented 4 spaces, so the
	// wrap budget is terminal width minus that indent. Below 20 cells the
	// wrap becomes useless, so we clamp instead of rendering an empty column.
	const indent = "    "
	wrapWidth := w - len(indent)
	if wrapWidth < 20 {
		wrapWidth = 20
	}

	lines := []string{
		"  " + titleStyle.Render(fmt.Sprintf("✗ Generation failed (exit code %d)", m.exitCode)),
		"",
	}
	if errMsg := strings.TrimSpace(m.stderrBuf.String()); errMsg != "" {
		// Render the captured stderr tail (last few lines) so the user has
		// context without dumping the entire buffer over the result screen.
		tail := lastLines(errMsg, 6)
		lines = append(lines, "  "+labelStyle.Render("Last output:"))
		for _, l := range strings.Split(tail, "\n") {
			for _, wrapped := range strings.Split(wordwrap.String(l, wrapWidth), "\n") {
				lines = append(lines, indent+wrapped)
			}
		}
	} else {
		lines = append(lines, "  "+labelStyle.Render("No stderr was captured. See subprocess output after dismissing."))
	}
	return strings.Join(lines, "\n")
}

// absPathLink resolves a possibly-relative directory into an absolute path
// plus a `file://` URL suitable for OSC 8 hyperlinks. On error (path can't
// be resolved) it returns the input unchanged so the result screen still
// displays *something* useful — the link just won't open.
func absPathLink(p string) (abs, fileURL string) {
	abs, err := filepath.Abs(p)
	if err != nil || abs == "" {
		return p, ""
	}
	// filepath.ToSlash converts Windows backslashes to forward slashes.
	// On Windows abs starts with a drive letter (`C:\foo`) → after ToSlash
	// `C:/foo`; the spec wants `file:///C:/foo` (three slashes). On Unix
	// abs starts with `/` so `file://` + `/path` already gives three slashes.
	slashed := filepath.ToSlash(abs)
	if strings.HasPrefix(slashed, "/") {
		fileURL = "file://" + slashed
	} else {
		fileURL = "file:///" + slashed
	}
	return abs, fileURL
}

// osc8Link wraps label in an OSC 8 hyperlink escape sequence pointing to
// target. Modern terminals (iTerm2, Windows Terminal, WezTerm, Kitty, recent
// gnome-terminal) render it as a clickable link; older ones fall back to
// showing the label as plain text (the escape bytes are zero-width).
func osc8Link(target, label string) string {
	if target == "" {
		return label
	}
	const esc = "\x1b"
	return esc + "]8;;" + target + esc + "\\" + label + esc + "]8;;" + esc + "\\"
}

// lastLines returns the trailing n newline-separated lines of s. Used to
// keep the failure screen compact when a subprocess dumps a long stderr.
func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) <= n {
		return strings.Join(lines, "\n")
	}
	return strings.Join(lines[len(lines)-n:], "\n")
}
