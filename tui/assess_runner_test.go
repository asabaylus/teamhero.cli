package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestSendInterviewAnswer_WritesJSONLine(t *testing.T) {
	buf := &bytes.Buffer{}
	res := &AssessRunResult{
		StdinW: writerCloser{buf},
	}
	if err := SendInterviewAnswer(res, "q1", "test value", true); err != nil {
		t.Fatalf("SendInterviewAnswer: %v", err)
	}
	out := buf.String()
	if !strings.HasSuffix(out, "\n") {
		t.Error("output should end with newline")
	}
	if !strings.Contains(out, `"questionId":"q1"`) {
		t.Errorf("missing questionId in output: %s", out)
	}
	if !strings.Contains(out, `"value":"test value"`) {
		t.Errorf("missing value in output: %s", out)
	}
	if !strings.Contains(out, `"isOption":true`) {
		t.Errorf("missing isOption in output: %s", out)
	}
	if !strings.Contains(out, `"type":"interview-answer"`) {
		t.Errorf("missing type in output: %s", out)
	}
}

// writerCloser adapts a bytes.Buffer to io.WriteCloser for tests.
type writerCloser struct{ *bytes.Buffer }

func (writerCloser) Close() error { return nil }

func TestAssessScriptPath_FallbackString(t *testing.T) {
	got := assessScriptPath()
	if got == "" {
		t.Error("assessScriptPath returned empty string")
	}
}

func TestAssessRunResult_CloseRunsCloseFns(t *testing.T) {
	called := false
	res := &AssessRunResult{
		closeFns: []func(){func() { called = true }},
	}
	res.Close()
	if !called {
		t.Error("Close should invoke closeFns")
	}
}
