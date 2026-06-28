package main

import "encoding/json"

// JSON-lines protocol types shared between Go TUI and TypeScript service runner.

// ProgressEvent represents a progress update from the service runner.
type ProgressEvent struct {
	Type     string   `json:"type"`
	Step     string   `json:"step,omitempty"`
	Status   string   `json:"status,omitempty"`
	Message  string   `json:"message,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
}

// ResultEvent signals the report was generated successfully.
type ResultEvent struct {
	Type       string `json:"type"`
	OutputPath string `json:"outputPath"`
}

// ErrorEvent signals a fatal error in the service runner.
type ErrorEvent struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

// DiscrepancySourceState represents a source platform state observation.
type DiscrepancySourceState struct {
	SourceName string `json:"sourceName"`
	State      string `json:"state"`
	URL        string `json:"url,omitempty"`
	ItemID     string `json:"itemId,omitempty"`
}

// DiscrepancyItem represents a single cross-source discrepancy.
type DiscrepancyItem struct {
	Contributor            string                 `json:"contributor"`
	ContributorDisplayName string                 `json:"contributorDisplayName"`
	SourceA                DiscrepancySourceState `json:"sourceA"`
	SourceB                DiscrepancySourceState `json:"sourceB"`
	SuggestedResolution    string                 `json:"suggestedResolution"`
	Confidence             int                    `json:"confidence"`
	Message                string                 `json:"message"`
	Rule                   string                 `json:"rule"`
	SectionName            string                 `json:"sectionName,omitempty"`
}

// DiscrepancyEvent carries per-contributor discrepancy data from the service runner.
type DiscrepancyEvent struct {
	Type           string                        `json:"type"`
	TotalCount     int                           `json:"totalCount"`
	ByContributor  map[string][]DiscrepancyItem  `json:"byContributor"`
	Unattributed   []DiscrepancyItem             `json:"unattributed"`
	Items          []DiscrepancyItem             `json:"items"`
	AllItems       []DiscrepancyItem             `json:"allItems,omitempty"`
	DiscrepancyThreshold  int                           `json:"discrepancyThreshold,omitempty"`
}

// GenericEvent is used for initial JSON unmarshalling to determine event type.
type GenericEvent struct {
	Type       string   `json:"type"`
	Step       string   `json:"step,omitempty"`
	Status     string   `json:"status,omitempty"`
	Message    string   `json:"message,omitempty"`
	Progress   *float64 `json:"progress,omitempty"`
	OutputPath string   `json:"outputPath,omitempty"`

	// Result event fields (type == "result")
	JsonOutputPath string `json:"jsonOutputPath,omitempty"`

	// Report data event fields (type == "report-data")
	Data json.RawMessage `json:"data,omitempty"`

	// Discrepancy event fields (type == "discrepancy")
	TotalCount    int                           `json:"totalCount,omitempty"`
	ByContributor map[string][]DiscrepancyItem  `json:"byContributor,omitempty"`
	Unattributed  []DiscrepancyItem             `json:"unattributed,omitempty"`
	Items         []DiscrepancyItem             `json:"items,omitempty"`
	AllItems      []DiscrepancyItem             `json:"allItems,omitempty"`
	DiscrepancyThreshold int                           `json:"discrepancyThreshold,omitempty"`
}
