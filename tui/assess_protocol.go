package main

// Assess-flow JSON-lines protocol additions, parallel to protocol.go.
// The shared envelope is GenericEvent (defined there); these types describe
// events specific to the maturity assessment.

// InterviewFrameEvent precedes the first question in an interactive run.
type InterviewFrameEvent struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// InterviewQuestionEvent — service → TUI. The TUI must reply with an
// InterviewAnswerEvent before the service can proceed.
type InterviewQuestionEvent struct {
	Type          string   `json:"type"`
	QuestionID    string   `json:"questionId"`
	QuestionText  string   `json:"questionText"`
	Options       []string `json:"options"`
	AllowFreeText bool     `json:"allowFreeText"`
	ConfigHeading string   `json:"configHeading"`
}

// InterviewAnswerEvent — TUI → service over the subprocess stdin.
type InterviewAnswerEvent struct {
	Type       string `json:"type"`
	QuestionID string `json:"questionId"`
	Value      string `json:"value"`
	IsOption   bool   `json:"isOption"`
}

// AssessResultData carries the rendered audit JSON. We use json.RawMessage on
// GenericEvent.Data; concrete Go-side parsing is not needed — the TUI just
// surfaces the raw markdown to the preview.
