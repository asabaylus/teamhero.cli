package main

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

// teaProgramRun executes a BubbleTea program — overridable in tests.
var teaProgramRun = func(p *tea.Program) (tea.Model, error) { return p.Run() }

// huhFormRun executes a huh form — overridable in tests.
var huhFormRun = func(f *huh.Form) error { return f.Run() }

// serviceScriptRunner executes a TypeScript service script — overridable in tests.
var serviceScriptRunner = func(script string, input interface{}) (map[string]interface{}, error) {
	return runServiceScript(script, input)
}
